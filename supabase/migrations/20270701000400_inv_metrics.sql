-- Controle de Estoque Inteligente — MÉTRICAS (parte 5): visão de saldos valorizados, indicadores, séries, estatísticas por produto e relatórios de giro.
-- Tudo calculado no banco, com autorização por papel e empresa (funções SECURITY INVOKER sobre tabelas com RLS, exceto nomes de membros).
-- «Hoje» e datas dos movimentos usam o fuso da empresa. Fórmulas em docs/METRICS.md e docs/STOCK_RULES.md.

begin;
set local check_function_bodies = off;

-- ======================================================================= saldos valorizados por produto × depósito
-- O valor do produto (centavos, inteiro) é distribuído entre os depósitos proporcionalmente ao saldo, pelo método do maior resto:
-- a soma dos depósitos fecha EXATAMENTE com o valor do produto.
create view public.inv_stock_view with (security_invoker = true) as
with tot as (
  select b.organization_id, b.product_id, sum(b.quantity_on_hand) as q from public.inventory_balances b group by 1, 2
), sh as (
  select b.organization_id, b.product_id, b.warehouse_id, b.quantity_on_hand as qty, b.version, t.q as q_total, c.total_value_cents as tv,
         case when t.q > 0 then div(c.total_value_cents::numeric * b.quantity_on_hand * 1000, t.q * 1000) else 0 end as base,
         case when t.q > 0 then mod(c.total_value_cents::numeric * b.quantity_on_hand * 1000, t.q * 1000) else 0 end as rem
  from public.inventory_balances b
  join tot t on t.organization_id = b.organization_id and t.product_id = b.product_id
  left join public.inventory_cost_state c on c.organization_id = b.organization_id and c.product_id = b.product_id
), r as (
  select sh.*, row_number() over (partition by organization_id, product_id order by rem desc, warehouse_id) as rn,
         coalesce(tv, 0) - sum(base) over (partition by organization_id, product_id) as k
  from sh
)
select r.organization_id, r.product_id, r.warehouse_id, p.sku, p.name as product_name, p.barcode, p.category_id, p.unit_id, u.symbol as unit_symbol, u.decimal_places,
       p.product_type, p.status as product_status, p.archived_at, p.default_supplier_id, w.name as warehouse_name, w.code as warehouse_code, w.active as warehouse_active,
       r.qty as quantity_on_hand, r.version as balance_version,
       (r.base + case when r.q_total > 0 and r.rn <= r.k then 1 else 0 end)::bigint as value_cents,
       case when r.q_total > 0 then round(coalesce(r.tv, 0)::numeric / r.q_total, 4) end as average_cost_cents,
       coalesce(rr.minimum_quantity, p.minimum_stock) as minimum_quantity,
       coalesce(rr.reorder_point, p.reorder_point, rr.minimum_quantity, p.minimum_stock) as reorder_point,
       coalesce(rr.target_quantity, p.target_stock) as target_quantity,
       private.inv_classify(r.qty, coalesce(rr.minimum_quantity, p.minimum_stock), coalesce(rr.reorder_point, p.reorder_point, rr.minimum_quantity, p.minimum_stock)) as stock_class,
       (rr.id is not null or p.minimum_stock is not null or p.reorder_point is not null) as monitored
from r
join public.products p on p.id = r.product_id and p.organization_id = r.organization_id
join public.units_of_measure u on u.id = p.unit_id
join public.warehouses w on w.id = r.warehouse_id
left join public.reorder_rules rr on rr.organization_id = r.organization_id and rr.product_id = r.product_id and rr.warehouse_id = r.warehouse_id and rr.enabled;
grant select on public.inv_stock_view to authenticated;
revoke all on public.inv_stock_view from anon;
grant execute on function private.inv_classify(numeric, numeric, numeric) to authenticated;

-- Operações com a numeração por empresa (1, 2, 3…), calculada na leitura: o número global da sequência nunca é exibido.
create view public.inv_operations_view with (security_invoker = true) as
select o.*, row_number() over (partition by o.organization_id order by o.op_number) as org_number from public.stock_operations o;
grant select on public.inv_operations_view to authenticated;
revoke all on public.inv_operations_view from anon;

-- Nomes dos membros (para «responsável» nas listas): qualquer membro vê os colegas da própria empresa, só nome de exibição.
create function public.inv_member_names(p_org uuid) returns table (user_id uuid, display_name text, role public.org_role)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.inv_guard(p_org, 'read');
  return query select m.user_id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1), 'usuário'), m.role
               from public.organization_members m left join public.profiles p on p.id = m.user_id where m.organization_id = p_org;
end $$;

-- ======================================================================= parâmetros comuns
create function private.inv_range(p_org uuid, p_from date, p_to date, p_today date) returns date
language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'período inválido (máximo de 367 dias)' using errcode = '22023'; end if;
  return coalesce(p_today, private.inv_today(p_org));
end $$;
revoke all on function private.inv_range(uuid, date, date, date) from public, anon;
grant execute on function private.inv_range(uuid, date, date, date) to authenticated;

-- categorias: a escolhida e todas as descendentes
create function private.inv_category_tree(p_org uuid, p_cat uuid) returns uuid[]
language sql stable set search_path = '' as $$
  with recursive t(id) as (
    select c.id from public.product_categories c where c.organization_id = p_org and c.id = p_cat
    union all select c.id from public.product_categories c join t on c.parent_id = t.id where c.organization_id = p_org)
  select coalesce(array_agg(id), '{}') from t;
$$;
revoke all on function private.inv_category_tree(uuid, uuid) from public, anon;
grant execute on function private.inv_category_tree(uuid, uuid) to authenticated;

-- ======================================================================= indicadores do painel
create function public.inv_dashboard_kpis(p_org uuid, p_from date, p_to date, p_warehouse uuid default null, p_category uuid default null, p_supplier uuid default null,
  p_product uuid default null, p_user uuid default null, p_today date default null) returns jsonb
language plpgsql stable set search_path = '' as $$
declare today_ date; tz text := private.inv_tz(p_org); cats uuid[]; idle_days_ integer; cov_days integer; res jsonb;
begin
  perform private.inv_guard(p_org, 'read');
  today_ := private.inv_range(p_org, p_from, p_to, p_today);
  select s.idle_days, s.coverage_window_days into idle_days_, cov_days from public.inv_settings s where s.organization_id = p_org;
  cats := case when p_category is null then null else private.inv_category_tree(p_org, p_category) end;
  with sp as (
    select p.id, p.unit_id, p.created_at from public.products p
    where p.organization_id = p_org and p.archived_at is null and p.status = 'active'
      and (p_product is null or p.id = p_product) and (cats is null or p.category_id = any (cats))
      and (p_supplier is null or p.default_supplier_id = p_supplier or exists (select 1 from public.product_suppliers ps where ps.product_id = p.id and ps.supplier_id = p_supplier))
  ), sv as (
    select v.* from public.inv_stock_view v join sp on sp.id = v.product_id where v.organization_id = p_org and (p_warehouse is null or v.warehouse_id = p_warehouse)
  ), mv as (
    select m.*, o.operation_type, (m.occurred_at at time zone tz)::date as d from public.stock_movements m join public.stock_operations o on o.id = m.operation_id join sp on sp.id = m.product_id
    where m.organization_id = p_org and (m.occurred_at at time zone tz)::date between p_from and p_to and (p_warehouse is null or m.warehouse_id = p_warehouse)
      and (p_user is null or m.performed_by = p_user)
  ), op_issue as (
    select m.product_id, m.operation_id, m.quantity_delta, m.value_delta_cents, m.reason_code from mv m where m.movement_type = 'issue' and m.reason_code in ('sale', 'internal_use')
  ), hist as (
    select distinct m.product_id from public.stock_movements m where m.organization_id = p_org
  ), cover as (
    select sp.id,
      (select sum(-m.quantity_delta) from public.stock_movements m where m.organization_id = p_org and m.product_id = sp.id and m.movement_type = 'issue' and m.reason_code in ('sale', 'internal_use')
         and (m.occurred_at at time zone tz)::date > today_ - cov_days and (m.occurred_at at time zone tz)::date <= today_ and (p_warehouse is null or m.warehouse_id = p_warehouse)) as consumed,
      (select count(distinct (m.occurred_at at time zone tz)::date) from public.stock_movements m where m.organization_id = p_org and m.product_id = sp.id and m.movement_type = 'issue'
         and m.reason_code in ('sale', 'internal_use') and (m.occurred_at at time zone tz)::date > today_ - cov_days and (m.occurred_at at time zone tz)::date <= today_ and (p_warehouse is null or m.warehouse_id = p_warehouse)) as days_with,
      (select sum(v.quantity_on_hand) from sv v where v.product_id = sp.id) as qty
    from sp
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'today', today_),
    'products_active', (select count(*) from sp),
    'skus_with_stock', (select count(distinct v.product_id) from sv v where v.quantity_on_hand > 0),
    'units', coalesce((select jsonb_agg(jsonb_build_object('symbol', x.unit_symbol, 'quantity', x.q, 'skus', x.n) order by x.unit_symbol)
                       from (select v.unit_symbol, sum(v.quantity_on_hand) q, count(distinct v.product_id) filter (where v.quantity_on_hand > 0) n from sv v group by 1) x), '[]'::jsonb),
    'stock_value_cents', (select coalesce(sum(v.value_cents), 0) from sv v),
    'below_minimum', (select count(*) from sv v where v.monitored and v.stock_class = 'critical'),
    'attention', (select count(*) from sv v where v.monitored and v.stock_class = 'attention'),
    'out_of_stock', (select count(*) from sp where exists (select 1 from hist h where h.product_id = sp.id)
                       and coalesce((select sum(v.quantity_on_hand) from sv v where v.product_id = sp.id), 0) = 0),
    'entries', jsonb_build_object('operations', (select count(distinct m.operation_id) from mv m where m.movement_type = 'entry'),
       'value_cents', (select coalesce(sum(m.value_delta_cents), 0) from mv m where m.movement_type = 'entry'),
       'by_unit', coalesce((select jsonb_agg(jsonb_build_object('symbol', x.symbol, 'quantity', x.q) order by x.symbol)
                            from (select u.symbol, sum(m.quantity_delta) q from mv m join public.products p on p.id = m.product_id join public.units_of_measure u on u.id = p.unit_id where m.movement_type = 'entry' group by 1) x), '[]'::jsonb)),
    'issues', jsonb_build_object('operations', (select count(distinct operation_id) from op_issue),
       'cost_cents', (select coalesce(-sum(value_delta_cents), 0) from op_issue),
       'by_unit', coalesce((select jsonb_agg(jsonb_build_object('symbol', x.symbol, 'quantity', x.q) order by x.symbol)
                            from (select u.symbol, -sum(i.quantity_delta) q from op_issue i join public.products p on p.id = i.product_id join public.units_of_measure u on u.id = p.unit_id group by 1) x), '[]'::jsonb),
       'other_operations', (select count(distinct m.operation_id) from mv m where m.movement_type = 'issue' and m.reason_code not in ('sale', 'internal_use')),
       'other_cost_cents', (select coalesce(-sum(m.value_delta_cents), 0) from mv m where m.movement_type = 'issue' and m.reason_code not in ('sale', 'internal_use'))),
    'transfers', (select count(distinct m.operation_id) from mv m where m.operation_type = 'transfer'),
    'adjustments', jsonb_build_object('operations', (select count(distinct m.operation_id) from mv m where m.movement_type in ('adjustment_in', 'adjustment_out')),
       'abs_value_cents', (select coalesce(sum(abs(m.value_delta_cents)), 0) from mv m where m.movement_type in ('adjustment_in', 'adjustment_out'))),
    'idle_products', (select count(*) from sp where sp.created_at < (today_ - idle_days_)::timestamp at time zone tz
                        and coalesce((select sum(v.quantity_on_hand) from sv v where v.product_id = sp.id), 0) > 0
                        and not exists (select 1 from public.stock_movements m where m.organization_id = p_org and m.product_id = sp.id and m.movement_type = 'issue' and m.reason_code in ('sale', 'internal_use')
                                          and (m.occurred_at at time zone tz)::date > today_ - idle_days_ and (m.occurred_at at time zone tz)::date <= today_)),
    'idle_days', idle_days_,
    'count_divergences', (select count(*) from public.physical_count_items i join public.physical_counts c on c.id = i.count_id join sp on sp.id = i.product_id
                          where c.organization_id = p_org and c.status = 'completed' and (c.completed_at at time zone tz)::date between p_from and p_to
                            and (p_warehouse is null or c.warehouse_id = p_warehouse) and i.counted_quantity is not null and i.counted_quantity <> i.expected_quantity),
    'coverage_days_median', (select percentile_disc(0.5) within group (order by (cv.qty / (cv.consumed / cov_days))) from cover cv where cv.days_with >= 3 and cv.consumed > 0 and cv.qty is not null),
    'coverage_products', (select count(*) from cover cv where cv.days_with >= 3 and cv.consumed > 0),
    'pending_counts', (select count(*) from public.physical_counts c where c.organization_id = p_org and c.status in ('counting', 'awaiting_approval') and (p_warehouse is null or c.warehouse_id = p_warehouse)),
    'pending_suggestions', (select count(*) from public.replenishment_suggestions s where s.organization_id = p_org and s.status = 'pending' and (p_warehouse is null or s.warehouse_id = p_warehouse)),
    'recent_operations', coalesce((select jsonb_agg(t.x order by t.at desc) from (
        select jsonb_build_object('id', o.id, 'number', (select count(*) from public.stock_operations x where x.organization_id = o.organization_id and x.op_number <= o.op_number), 'type', o.operation_type, 'reason', o.reason_code, 'warehouse_id', coalesce(o.warehouse_id, o.source_warehouse_id),
               'destination_id', o.destination_warehouse_id, 'reference', o.external_reference, 'user_id', o.created_by, 'at', o.occurred_at, 'status', o.status,
               'items', (select count(*) from public.stock_operation_items i where i.operation_id = o.id)) as x, o.occurred_at as at
        from public.stock_operations o where o.organization_id = p_org and (o.occurred_at at time zone tz)::date between p_from and p_to
          and (p_warehouse is null or o.warehouse_id = p_warehouse or o.source_warehouse_id = p_warehouse or o.destination_warehouse_id = p_warehouse) and (p_user is null or o.created_by = p_user)
        order by o.occurred_at desc, o.op_number desc limit 10) t), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- ======================================================================= séries e distribuições
create function public.inv_dashboard_series(p_org uuid, p_from date, p_to date, p_warehouse uuid default null, p_category uuid default null, p_supplier uuid default null,
  p_product uuid default null, p_user uuid default null, p_today date default null) returns jsonb
language plpgsql stable set search_path = '' as $$
declare today_ date; tz text := private.inv_tz(p_org); cats uuid[]; step text; res jsonb; span integer := p_to - p_from;
begin
  perform private.inv_guard(p_org, 'read');
  today_ := private.inv_range(p_org, p_from, p_to, p_today);
  cats := case when p_category is null then null else private.inv_category_tree(p_org, p_category) end;
  step := case when span <= 62 then 'day' when span <= 190 then 'week' else 'month' end;
  with sp as (
    select p.id, p.category_id, p.unit_id, p.status, p.archived_at, p.name, p.sku from public.products p
    where p.organization_id = p_org and (p_product is null or p.id = p_product) and (cats is null or p.category_id = any (cats))
      and (p_supplier is null or p.default_supplier_id = p_supplier or exists (select 1 from public.product_suppliers ps where ps.product_id = p.id and ps.supplier_id = p_supplier))
  ), grid as (
    select g::date as b from generate_series(date_trunc(step, p_from::timestamp), date_trunc(step, p_to::timestamp), ('1 ' || step)::interval) g
  ), mv as (
    select m.*, o.operation_type, date_trunc(step, (m.occurred_at at time zone tz))::date as b, (m.occurred_at at time zone tz)::date as d
    from public.stock_movements m join public.stock_operations o on o.id = m.operation_id join sp on sp.id = m.product_id
    where m.organization_id = p_org and (p_warehouse is null or m.warehouse_id = p_warehouse) and (p_user is null or m.performed_by = p_user)
  ), mp as (select * from mv where d between p_from and p_to), sv as (
    select v.* from public.inv_stock_view v join sp on sp.id = v.product_id and sp.archived_at is null where v.organization_id = p_org and (p_warehouse is null or v.warehouse_id = p_warehouse)
  ), ends as (
    select g.b, least((g.b + ('1 ' || step)::interval)::date - 1, p_to) as e from grid g
  )
  select jsonb_build_object(
    'step', step,
    'flow', coalesce((select jsonb_agg(jsonb_build_object('period', g.b, 'entry_ops', coalesce(f.eo, 0), 'issue_ops', coalesce(f.io, 0), 'entry_value_cents', coalesce(f.ev, 0), 'issue_value_cents', coalesce(f.iv, 0)) order by g.b)
        from grid g left join (select mp.b, count(distinct mp.operation_id) filter (where mp.movement_type = 'entry') eo, count(distinct mp.operation_id) filter (where mp.movement_type = 'issue') io,
                                sum(mp.value_delta_cents) filter (where mp.movement_type = 'entry') ev, -sum(mp.value_delta_cents) filter (where mp.movement_type = 'issue') iv from mp group by mp.b) f on f.b = g.b), '[]'::jsonb),
    'value_by_category', coalesce((select jsonb_agg(jsonb_build_object('category', x.name, 'value_cents', x.v) order by x.v desc)
        from (select coalesce(c.name, 'Sem categoria') name, sum(v.value_cents) v from sv v left join public.product_categories c on c.id = v.category_id group by 1 having sum(v.value_cents) > 0) x), '[]'::jsonb),
    'below_minimum', coalesce((select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'sku', x.sku, 'name', x.product_name, 'warehouse', x.warehouse_name, 'quantity', x.quantity_on_hand, 'minimum', x.minimum_quantity,
        'reorder_point', x.reorder_point, 'unit', x.unit_symbol, 'class', x.stock_class) order by x.quantity_on_hand / nullif(x.minimum_quantity, 0), x.sku)
        from (select * from sv where monitored and stock_class in ('critical', 'out_of_stock') order by quantity_on_hand / nullif(minimum_quantity, 0), sku limit 15) x), '[]'::jsonb),
    'stock_by_warehouse', coalesce((select jsonb_agg(jsonb_build_object('warehouse', x.warehouse_name, 'code', x.warehouse_code, 'value_cents', x.v, 'skus', x.n) order by x.v desc)
        from (select v.warehouse_name, v.warehouse_code, sum(v.value_cents) v, count(distinct v.product_id) filter (where v.quantity_on_hand > 0) n from sv v group by 1, 2) x), '[]'::jsonb),
    'top_issues', coalesce((select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'sku', x.sku, 'name', x.name, 'cost_cents', x.cost, 'quantity', x.q, 'unit', x.symbol) order by x.cost desc, x.sku)
        from (select sp.id product_id, sp.sku, sp.name, -sum(mp.value_delta_cents) cost, -sum(mp.quantity_delta) q, u.symbol
              from mp join sp on sp.id = mp.product_id join public.units_of_measure u on u.id = sp.unit_id
              where mp.movement_type = 'issue' and mp.reason_code in ('sale', 'internal_use') group by 1, 2, 3, 6 order by 4 desc, 2 limit 10) x), '[]'::jsonb),
    'value_evolution', coalesce((select jsonb_agg(jsonb_build_object('period', en.b, 'value_cents', (select coalesce(sum(m2.value_delta_cents), 0) from mv m2 where m2.d <= en.e)) order by en.b) from ends en), '[]'::jsonb),
    'status_distribution', jsonb_build_object(
        'active', (select count(*) from sp where status = 'active' and archived_at is null), 'inactive', (select count(*) from sp where status = 'inactive' and archived_at is null),
        'archived', (select count(*) from sp where archived_at is not null),
        'normal', (select count(*) from (select product_id from sv where product_status = 'active' group by 1 having bool_and(not monitored or stock_class = 'normal')) z),
        'attention', (select count(*) from (select product_id from sv where product_status = 'active' group by 1 having bool_or(monitored and stock_class = 'attention') and not bool_or(monitored and stock_class in ('critical', 'out_of_stock'))) z),
        'critical', (select count(*) from (select product_id from sv where product_status = 'active' group by 1 having bool_or(monitored and stock_class in ('critical', 'out_of_stock'))) z)),
    'turnover_by_category', coalesce((select jsonb_agg(jsonb_build_object('category', x.name, 'cost_cents', x.cost, 'avg_value_cents', x.avgv,
          'turnover', case when x.avgv > 0 then round(x.cost::numeric / x.avgv, 2) end) order by x.name) from (
        select coalesce(c.name, 'Sem categoria') as name,
               coalesce((select sum(-mp.value_delta_cents) from mp join sp s2 on s2.id = mp.product_id
                         where s2.category_id is not distinct from k.category_id and mp.movement_type = 'issue' and mp.reason_code in ('sale', 'internal_use')), 0) as cost,
               coalesce((select round(avg(t.v)) from (select (select coalesce(sum(m3.value_delta_cents), 0) from mv m3 join sp s3 on s3.id = m3.product_id
                                                              where s3.category_id is not distinct from k.category_id and m3.d <= en.e) as v from ends en) t), 0) as avgv
        from (select distinct sp.category_id from sp) k left join public.product_categories c on c.id = k.category_id) x where x.cost > 0 or x.avgv > 0), '[]'::jsonb),
    'count_adjustments', coalesce((select jsonb_agg(jsonb_build_object('period', g.b, 'items', coalesce(c.n, 0), 'abs_value_cents', coalesce(c.v, 0)) order by g.b)
        from grid g left join (select mp.b, count(*) n, sum(abs(mp.value_delta_cents)) v from mp where mp.movement_type in ('count_in', 'count_out') group by mp.b) c on c.b = g.b), '[]'::jsonb),
    'movements_by_type', coalesce((select jsonb_agg(jsonb_build_object('period', g.b, 'entry', coalesce(t.e, 0), 'issue', coalesce(t.i, 0), 'transfer', coalesce(t.t, 0), 'adjustment', coalesce(t.a, 0), 'count', coalesce(t.c, 0), 'reversal', coalesce(t.r, 0)) order by g.b)
        from grid g left join (select mp.b, count(distinct mp.operation_id) filter (where mp.movement_type = 'entry' or mp.movement_type = 'opening') e, count(distinct mp.operation_id) filter (where mp.movement_type = 'issue') i,
           count(distinct mp.operation_id) filter (where mp.operation_type = 'transfer') t, count(distinct mp.operation_id) filter (where mp.movement_type in ('adjustment_in', 'adjustment_out')) a,
           count(distinct mp.operation_id) filter (where mp.movement_type in ('count_in', 'count_out')) c, count(distinct mp.operation_id) filter (where mp.movement_type = 'reversal') r from mp group by mp.b) t on t.b = g.b), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- ======================================================================= estatísticas de um produto
create function public.inv_product_stats(p_org uuid, p_product uuid, p_from date, p_to date, p_today date default null) returns jsonb
language plpgsql stable set search_path = '' as $$
declare today_ date; tz text := private.inv_tz(p_org); cov_days integer; res jsonb; consumed numeric; days_with integer; qty numeric; span integer := p_to - p_from;
begin
  perform private.inv_guard(p_org, 'read');
  today_ := private.inv_range(p_org, p_from, p_to, p_today);
  if not exists (select 1 from public.products p where p.id = p_product and p.organization_id = p_org) then raise exception 'produto não encontrado' using errcode = '22023'; end if;
  select s.coverage_window_days into cov_days from public.inv_settings s where s.organization_id = p_org;
  select coalesce(-sum(m.quantity_delta), 0), count(distinct (m.occurred_at at time zone tz)::date) into consumed, days_with
    from public.stock_movements m where m.organization_id = p_org and m.product_id = p_product and m.movement_type = 'issue' and m.reason_code in ('sale', 'internal_use')
     and (m.occurred_at at time zone tz)::date > today_ - cov_days and (m.occurred_at at time zone tz)::date <= today_;
  select coalesce(sum(quantity_on_hand), 0) into qty from public.inventory_balances where organization_id = p_org and product_id = p_product;
  select jsonb_build_object(
    'quantity', qty,
    'value_cents', coalesce((select c.total_value_cents from public.inventory_cost_state c where c.organization_id = p_org and c.product_id = p_product), 0),
    'average_cost_cents', (select case when c.quantity_valued > 0 then round(c.total_value_cents::numeric / c.quantity_valued, 4) end from public.inventory_cost_state c where c.organization_id = p_org and c.product_id = p_product),
    'by_warehouse', coalesce((select jsonb_agg(jsonb_build_object('warehouse_id', v.warehouse_id, 'name', v.warehouse_name, 'code', v.warehouse_code, 'quantity', v.quantity_on_hand, 'value_cents', v.value_cents,
        'minimum', v.minimum_quantity, 'reorder_point', v.reorder_point, 'target', v.target_quantity, 'class', v.stock_class) order by v.warehouse_name)
        from public.inv_stock_view v where v.organization_id = p_org and v.product_id = p_product), '[]'::jsonb),
    'entries_period', (select coalesce(sum(m.quantity_delta), 0) from public.stock_movements m where m.organization_id = p_org and m.product_id = p_product and m.movement_type = 'entry' and (m.occurred_at at time zone tz)::date between p_from and p_to),
    'issues_period', (select coalesce(-sum(m.quantity_delta), 0) from public.stock_movements m where m.organization_id = p_org and m.product_id = p_product and m.movement_type = 'issue' and (m.occurred_at at time zone tz)::date between p_from and p_to),
    'operational_issues_period', (select coalesce(-sum(m.quantity_delta), 0) from public.stock_movements m where m.organization_id = p_org and m.product_id = p_product and m.movement_type = 'issue' and m.reason_code in ('sale', 'internal_use') and (m.occurred_at at time zone tz)::date between p_from and p_to),
    'last_entry_at', (select max(m.occurred_at) from public.stock_movements m where m.organization_id = p_org and m.product_id = p_product and m.movement_type = 'entry'),
    'last_issue_at', (select max(m.occurred_at) from public.stock_movements m where m.organization_id = p_org and m.product_id = p_product and m.movement_type = 'issue'),
    'coverage_days', case when days_with >= 3 and consumed > 0 then round(qty / (consumed / cov_days), 1) end,
    'coverage_note', case when consumed = 0 then 'sem consumo no período' when days_with < 3 then 'poucos dias com saída para estimar' end,
    'balance_series', coalesce((select jsonb_agg(jsonb_build_object('date', g.d, 'quantity', (select coalesce(sum(m.quantity_delta), 0) from public.stock_movements m where m.organization_id = p_org and m.product_id = p_product and (m.occurred_at at time zone tz)::date <= g.d)) order by g.d)
        from (select (p_from + s)::date d from generate_series(0, span) s) g), '[]'::jsonb),
    'cost_series', coalesce((select jsonb_agg(jsonb_build_object('date', x.d, 'average_cost_cents', x.avg) order by x.d) from (
        select distinct on ((m.occurred_at at time zone tz)::date) (m.occurred_at at time zone tz)::date d, e.average_cost_after avg
        from public.inventory_cost_events e join public.stock_movements m on m.id = e.movement_id
        where e.organization_id = p_org and e.product_id = p_product and (m.occurred_at at time zone tz)::date between p_from and p_to
        order by (m.occurred_at at time zone tz)::date, m.created_at desc, m.id desc) x), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- ======================================================================= relatórios de giro, cobertura e parados
-- Giro (vezes) = saídas operacionais ÷ estoque médio do período (média do saldo ao fim de cada dia). Indisponível com estoque médio zero
-- ou produto com menos de 30 dias de cadastro. Cobertura só com >= 3 dias com saída na janela (dias = janela de cobertura).
create function public.inv_report_turnover(p_org uuid, p_from date, p_to date, p_warehouse uuid default null, p_category uuid default null, p_today date default null)
returns table (product_id uuid, sku text, name text, unit_symbol text, category_name text, issued_qty numeric, average_stock numeric, turnover numeric, coverage_days numeric, last_issue_date date, quantity_now numeric, history_days integer)
language plpgsql stable set search_path = '' as $$
declare today_ date; tz text := private.inv_tz(p_org); cats uuid[]; cov_days integer; span integer := p_to - p_from + 1;
begin
  perform private.inv_guard(p_org, 'read');
  today_ := private.inv_range(p_org, p_from, p_to, p_today);
  select s.coverage_window_days into cov_days from public.inv_settings s where s.organization_id = p_org;
  cats := case when p_category is null then null else private.inv_category_tree(p_org, p_category) end;
  return query
  with sp as (
    select p.id, p.sku, p.name, p.created_at, u.symbol, c.name as cat from public.products p join public.units_of_measure u on u.id = p.unit_id left join public.product_categories c on c.id = p.category_id
    where p.organization_id = p_org and p.archived_at is null and p.status = 'active' and (cats is null or p.category_id = any (cats))
  ), mv as (
    select m.product_id, m.quantity_delta, m.movement_type, m.reason_code, (m.occurred_at at time zone tz)::date as d from public.stock_movements m
    where m.organization_id = p_org and (p_warehouse is null or m.warehouse_id = p_warehouse) and (m.occurred_at at time zone tz)::date <= p_to
  ), base as (
    select sp.id, coalesce((select sum(mv.quantity_delta) from mv where mv.product_id = sp.id and mv.d < p_from), 0) as q0 from sp
  ), daily as (
    select b.id, g.d, b.q0 + coalesce((select sum(mv.quantity_delta) from mv where mv.product_id = b.id and mv.d >= p_from and mv.d <= g.d), 0) as q
    from base b cross join (select (p_from + s)::date as d from generate_series(0, p_to - p_from) s) g
  ), avg_ as (select d.id, avg(d.q) as a from daily d group by d.id),
  iss as (
    select mv.product_id, -sum(mv.quantity_delta) as q from mv where mv.movement_type = 'issue' and mv.reason_code in ('sale', 'internal_use') and mv.d between p_from and p_to group by 1
  ), cov as (
    select mv.product_id, -sum(mv.quantity_delta) as q, count(distinct mv.d) as n, max(mv.d) as last_d from mv
    where mv.movement_type = 'issue' and mv.reason_code in ('sale', 'internal_use') and mv.d > today_ - cov_days and mv.d <= today_ group by 1
  ), lastiss as (
    select mv.product_id, max(mv.d) as d from mv where mv.movement_type = 'issue' and mv.reason_code in ('sale', 'internal_use') group by 1
  ), now_ as (
    select b.product_id, sum(b.quantity_on_hand) as q from public.inventory_balances b where b.organization_id = p_org and (p_warehouse is null or b.warehouse_id = p_warehouse) group by 1
  )
  select sp.id, sp.sku, sp.name, sp.symbol, sp.cat, coalesce(iss.q, 0), round(coalesce(a.a, 0), 3),
         case when coalesce(a.a, 0) > 0 and (today_ - (sp.created_at at time zone tz)::date) >= 30 then round(coalesce(iss.q, 0) / a.a, 2) end,
         case when cov.n >= 3 and cov.q > 0 then round(coalesce(n_.q, 0) / (cov.q / cov_days), 1) end,
         li.d, coalesce(n_.q, 0), (today_ - (sp.created_at at time zone tz)::date)
  from sp left join avg_ a on a.id = sp.id left join iss on iss.product_id = sp.id left join cov on cov.product_id = sp.id left join lastiss li on li.product_id = sp.id left join now_ n_ on n_.product_id = sp.id
  order by coalesce(iss.q, 0) desc, sp.sku;
end $$;

create function public.inv_report_idle(p_org uuid, p_days integer, p_warehouse uuid default null, p_today date default null)
returns table (product_id uuid, sku text, name text, unit_symbol text, quantity_now numeric, value_cents bigint, last_issue_date date, days_since_issue integer)
language plpgsql stable set search_path = '' as $$
declare today_ date; tz text := private.inv_tz(p_org);
begin
  perform private.inv_guard(p_org, 'read');
  if p_days is null or p_days not between 7 and 730 then raise exception 'período de parados inválido (7 a 730 dias)' using errcode = '22023'; end if;
  today_ := coalesce(p_today, private.inv_today(p_org));
  return query
  select v.product_id, v.sku, v.product_name, v.unit_symbol, sum(v.quantity_on_hand), sum(v.value_cents)::bigint, li.d, case when li.d is null then null else today_ - li.d end
  from public.inv_stock_view v
  join public.products p on p.id = v.product_id and p.created_at < (today_ - p_days)::timestamp at time zone tz and p.archived_at is null and p.status = 'active'
  left join lateral (select max((m.occurred_at at time zone tz)::date) d from public.stock_movements m where m.organization_id = p_org and m.product_id = v.product_id and m.movement_type = 'issue' and m.reason_code in ('sale', 'internal_use')) li on true
  where v.organization_id = p_org and (p_warehouse is null or v.warehouse_id = p_warehouse)
  group by v.product_id, v.sku, v.product_name, v.unit_symbol, li.d
  having sum(v.quantity_on_hand) > 0 and (li.d is null or li.d <= today_ - p_days)
  order by li.d nulls first, v.sku;
end $$;

-- ======================================================================= privilégios
do $$
declare f text;
begin
  foreach f in array array[
    'public.inv_member_names(uuid)',
    'public.inv_dashboard_kpis(uuid, date, date, uuid, uuid, uuid, uuid, uuid, date)',
    'public.inv_dashboard_series(uuid, date, date, uuid, uuid, uuid, uuid, uuid, date)',
    'public.inv_product_stats(uuid, uuid, date, date, date)',
    'public.inv_report_turnover(uuid, date, date, uuid, uuid, date)',
    'public.inv_report_idle(uuid, integer, uuid, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
