-- Controle de Estoque Inteligente — INVENTÁRIO FÍSICO, REPOSIÇÃO e AVISOS (parte 4).
-- Contagem: snapshot (esperado + versão do saldo) → contagem → envio → aprovação (gera ajustes) | saldo mudou ⇒ recontagem.
-- Reposição: sugestões idempotentes, nunca pedidos de compra. Avisos: por usuário, com chave de deduplicação.

begin;
set local check_function_bodies = off;

-- ======================================================================= avisos
-- FK só para organization_members (nunca também para organizations): evita o embed ambíguo PGRST201 do Core.
create table public.inv_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  type text not null check (type in ('below_minimum', 'out_of_stock', 'idle_product', 'count_done', 'count_divergence', 'replenishment', 'import_failed', 'operation_reversed', 'count_waiting')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 300),
  link text check (link is null or link ~ '^/[a-z0-9/?=&_.-]*$'),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 120),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index inv_notifications_user_idx on public.inv_notifications (user_id, organization_id, read_at, created_at desc);

create table public.inv_notification_prefs (
  organization_id uuid not null,
  user_id uuid not null,
  type text not null,
  enabled boolean not null default true,
  primary key (organization_id, user_id, type),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['inv_notifications', 'inv_notification_prefs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()) and private.inv_can_read(organization_id))', t || '_select', t);
  end loop;
end $$;

create function private.inv_notify(p_org uuid, p_type text, p_title text, p_body text, p_link text, p_dedupe text, p_roles public.org_role[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.inv_notifications (organization_id, user_id, type, title, body, link, dedupe_key)
  select m.organization_id, m.user_id, p_type, p_title, p_body, p_link, p_dedupe
  from public.organization_members m
  where m.organization_id = p_org and m.role = any (p_roles)
    and coalesce((select pr.enabled from public.inv_notification_prefs pr where pr.organization_id = m.organization_id and pr.user_id = m.user_id and pr.type = p_type), true)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.inv_notify(uuid, text, text, text, text, text, public.org_role[]) from public, anon, authenticated;

create function public.inv_mark_notifications_read(p_org uuid, p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.inv_guard(p_org, 'read');
  update public.inv_notifications set read_at = now() where organization_id = p_org and user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create function public.inv_set_notification_pref(p_org uuid, p_type text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.inv_guard(p_org, 'read');
  if p_type not in ('below_minimum', 'out_of_stock', 'idle_product', 'count_done', 'count_divergence', 'replenishment', 'import_failed', 'operation_reversed', 'count_waiting') then
    raise exception 'tipo de aviso inválido' using errcode = '22023';
  end if;
  insert into public.inv_notification_prefs (organization_id, user_id, type, enabled) values (p_org, (select auth.uid()), p_type, coalesce(p_enabled, true))
  on conflict (organization_id, user_id, type) do update set enabled = excluded.enabled;
end $$;

-- ======================================================================= inventário físico
create function public.inv_create_count(p_org uuid, p_warehouse uuid, p_title text, p_products uuid[], p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid; pr uuid[]; wh uuid[]; n integer; i integer;
begin
  perform private.inv_guard(p_org, 'operator', p_warehouse);
  if p_title is null or char_length(trim(p_title)) not between 1 and 120 then raise exception 'informe o título do inventário' using errcode = '22023'; end if;
  perform private.inv_check_warehouse(p_org, p_warehouse);
  perform pg_advisory_xact_lock(hashtextextended('inv_count:' || p_warehouse::text, 0));
  if exists (select 1 from public.physical_counts c where c.warehouse_id = p_warehouse and c.status in ('counting', 'awaiting_approval')) then
    raise exception 'já existe um inventário em andamento neste depósito' using errcode = '55000';
  end if;
  if p_products is null then
    select array_agg(b.product_id order by b.product_id) into pr from public.inventory_balances b join public.products p on p.id = b.product_id
      where b.organization_id = p_org and b.warehouse_id = p_warehouse and b.quantity_on_hand > 0 and p.archived_at is null and p.status = 'active';
  else
    select array_agg(distinct x order by x) into pr from unnest(p_products) x;
  end if;
  n := coalesce(cardinality(pr), 0);
  if n = 0 then raise exception 'nenhum produto para contar: informe os produtos (não há saldo neste depósito)' using errcode = '22023'; end if;
  if n > 2000 then raise exception 'inventário com no máximo 2000 produtos (divida por categoria ou prateleira)' using errcode = '22023'; end if;
  if (select count(*) from public.products p where p.organization_id = p_org and p.id = any (pr) and p.archived_at is null and p.status = 'active') <> n then
    raise exception 'há produto inexistente, inativo ou arquivado na lista' using errcode = '22023';
  end if;
  select array_agg(p_warehouse) into wh from unnest(pr);
  perform private.inv_lock(p_org, wh, pr);
  insert into public.physical_counts (organization_id, warehouse_id, title, status, notes, started_at, created_by)
    values (p_org, p_warehouse, trim(p_title), 'counting', nullif(trim(p_notes), ''), now(), (select auth.uid())) returning id into cid;
  insert into public.physical_count_items (organization_id, count_id, product_id, expected_quantity, balance_version_at_snapshot)
    select p_org, cid, b.product_id, b.quantity_on_hand, b.version from public.inventory_balances b where b.organization_id = p_org and b.warehouse_id = p_warehouse and b.product_id = any (pr);
  return cid;
end $$;

create function public.inv_count_add_product(p_count uuid, p_product uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.physical_counts%rowtype; b public.inventory_balances%rowtype;
begin
  select * into c from public.physical_counts where id = p_count for update;
  if not found then raise exception 'inventário não encontrado' using errcode = '22023'; end if;
  perform private.inv_guard(c.organization_id, 'operator', c.warehouse_id);
  if c.status <> 'counting' then raise exception 'só é possível incluir produto enquanto o inventário está em contagem' using errcode = '55000'; end if;
  perform private.inv_check_product(c.organization_id, p_product, 1);
  perform private.inv_lock(c.organization_id, array[c.warehouse_id], array[p_product]);
  select * into b from public.inventory_balances where organization_id = c.organization_id and product_id = p_product and warehouse_id = c.warehouse_id;
  insert into public.physical_count_items (organization_id, count_id, product_id, expected_quantity, balance_version_at_snapshot)
    values (c.organization_id, p_count, p_product, b.quantity_on_hand, b.version) on conflict do nothing;
end $$;

create function public.inv_count_record(p_item uuid, p_counted numeric, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare it public.physical_count_items%rowtype; c public.physical_counts%rowtype; u public.units_of_measure%rowtype;
begin
  select * into it from public.physical_count_items where id = p_item for update;
  if not found then raise exception 'item de inventário não encontrado' using errcode = '22023'; end if;
  select * into c from public.physical_counts where id = it.count_id;
  perform private.inv_guard(c.organization_id, 'operator', c.warehouse_id);
  if c.status <> 'counting' then raise exception 'o inventário não está em contagem' using errcode = '55000'; end if;
  if p_counted is null or p_counted < 0 or p_counted >= 1000000000000 then raise exception 'quantidade contada inválida' using errcode = '22023'; end if;
  select un.* into u from public.units_of_measure un join public.products p on p.unit_id = un.id where p.id = it.product_id;
  if p_counted <> round(p_counted, u.decimal_places) then raise exception 'quantidade contada aceita no máximo % casa(s) decimal(is) (unidade %)', u.decimal_places, u.symbol using errcode = '22023'; end if;
  update public.physical_count_items set counted_quantity = p_counted, counted_by = (select auth.uid()), counted_at = now(), note = nullif(left(trim(p_note), 300), '') where id = p_item;
end $$;

create function public.inv_submit_count(p_count uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.physical_counts%rowtype;
begin
  select * into c from public.physical_counts where id = p_count for update;
  if not found then raise exception 'inventário não encontrado' using errcode = '22023'; end if;
  perform private.inv_guard(c.organization_id, 'operator', c.warehouse_id);
  if c.status <> 'counting' then raise exception 'o inventário não está em contagem' using errcode = '55000'; end if;
  if not exists (select 1 from public.physical_count_items i where i.count_id = p_count and i.counted_quantity is not null) then
    raise exception 'registre ao menos uma contagem antes de enviar para aprovação' using errcode = '55000';
  end if;
  update public.physical_counts set status = 'awaiting_approval', submitted_at = now() where id = p_count;
  perform private.inv_notify(c.organization_id, 'count_waiting', 'Inventário aguardando aprovação', left(c.title, 200), '/inventarios/' || p_count::text, 'count_wait:' || p_count::text, array['owner', 'admin', 'manager']::public.org_role[]);
end $$;

-- Reabre a contagem dos itens cujo saldo mudou depois do snapshot (novo esperado e nova versão; contagem anterior descartada).
create function public.inv_reopen_stale_count(p_count uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.physical_counts%rowtype; pr uuid[]; wh uuid[]; n integer;
begin
  select * into c from public.physical_counts where id = p_count for update;
  if not found then raise exception 'inventário não encontrado' using errcode = '22023'; end if;
  perform private.inv_guard(c.organization_id, 'manager', c.warehouse_id);
  if c.status <> 'awaiting_approval' then raise exception 'só inventário aguardando aprovação pode ser reaberto' using errcode = '55000'; end if;
  select array_agg(i.product_id order by i.product_id) into pr from public.physical_count_items i where i.count_id = p_count;
  select array_agg(c.warehouse_id) into wh from unnest(pr);
  perform private.inv_lock(c.organization_id, wh, pr);
  update public.physical_count_items i set expected_quantity = b.quantity_on_hand, balance_version_at_snapshot = b.version, counted_quantity = null, counted_by = null, counted_at = null
    from public.inventory_balances b where i.count_id = p_count and b.organization_id = c.organization_id and b.product_id = i.product_id and b.warehouse_id = c.warehouse_id
      and i.counted_quantity is not null and b.version <> i.balance_version_at_snapshot;
  get diagnostics n = row_count;
  update public.physical_counts set status = 'counting', submitted_at = null where id = p_count;
  return n;
end $$;

create function public.inv_count_set_surplus_cost(p_item uuid, p_unit_cost numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare it public.physical_count_items%rowtype; c public.physical_counts%rowtype;
begin
  select * into it from public.physical_count_items where id = p_item for update;
  if not found then raise exception 'item de inventário não encontrado' using errcode = '22023'; end if;
  select * into c from public.physical_counts where id = it.count_id;
  perform private.inv_guard(c.organization_id, 'manager', c.warehouse_id);
  if c.status not in ('counting', 'awaiting_approval') then raise exception 'inventário já encerrado' using errcode = '55000'; end if;
  if p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost >= 100000000000000 or p_unit_cost <> round(p_unit_cost, 4)) then raise exception 'custo unitário inválido (centavos, até 4 casas)' using errcode = '22023'; end if;
  update public.physical_count_items set surplus_unit_cost_cents = p_unit_cost where id = p_item;
end $$;

create function public.inv_cancel_count(p_count uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.physical_counts%rowtype;
begin
  select * into c from public.physical_counts where id = p_count for update;
  if not found then raise exception 'inventário não encontrado' using errcode = '22023'; end if;
  perform private.inv_guard(c.organization_id, 'operator', c.warehouse_id);
  if c.status not in ('counting', 'awaiting_approval') then raise exception 'inventário já encerrado' using errcode = '55000'; end if;
  if c.created_by <> (select auth.uid()) and not private.inv_is_manager(c.organization_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo do cancelamento (mínimo 5 caracteres)' using errcode = '22023'; end if;
  update public.physical_counts set status = 'cancelled', cancelled_at = now(), notes = left(coalesce(notes || E'\n', '') || 'Cancelado: ' || trim(p_reason), 500) where id = p_count;
end $$;

-- Aprovação: só se NENHUM item contado ficou desatualizado; gera uma operação de ajuste com as diferenças.
create function public.inv_approve_count(p_count uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.physical_counts%rowtype; pr uuid[]; wh uuid[]; stale integer; op uuid; cs public.inventory_cost_state%rowtype; it record; line integer := 0; diff numeric;
  val bigint; uc numeric; pol text; iid uuid; sku text; ndiff integer := 0; key_ text; h text;
begin
  select * into c from public.physical_counts where id = p_count for update;
  if not found then raise exception 'inventário não encontrado' using errcode = '22023'; end if;
  perform private.inv_guard(c.organization_id, 'manager', c.warehouse_id);
  if c.status = 'completed' then raise exception 'inventário já concluído' using errcode = '55000'; end if;
  if c.status <> 'awaiting_approval' then raise exception 'só inventário aguardando aprovação pode ser aprovado' using errcode = '55000'; end if;
  select array_agg(i.product_id order by i.product_id) into pr from public.physical_count_items i where i.count_id = p_count and i.counted_quantity is not null;
  select array_agg(c.warehouse_id) into wh from unnest(pr);
  perform private.inv_lock(c.organization_id, wh, pr);
  select count(*) into stale from public.physical_count_items i join public.inventory_balances b
    on b.organization_id = c.organization_id and b.product_id = i.product_id and b.warehouse_id = c.warehouse_id
    where i.count_id = p_count and i.counted_quantity is not null and b.version <> i.balance_version_at_snapshot;
  if stale > 0 then
    raise exception '% item(ns) com saldo alterado depois do início da contagem: reabra para recontar (nenhum ajuste foi aplicado)', stale using errcode = '55000';
  end if;
  select count(*) into ndiff from public.physical_count_items i where i.count_id = p_count and i.counted_quantity is not null and i.counted_quantity <> i.expected_quantity;
  if ndiff > 0 then
    key_ := 'count:' || p_count::text;
    h := private.inv_hash('count', c.organization_id::text, p_count::text);
    op := private.inv_open_op(c.organization_id, 'count_adjustment', 'count_difference', c.warehouse_id, null, null, null, null, 'Inventário: ' || c.title, key_, h, now(), null, null, p_count);
    for it in select i.* from public.physical_count_items i where i.count_id = p_count and i.counted_quantity is not null and i.counted_quantity <> i.expected_quantity order by i.product_id loop
      line := line + 1;
      sku := (select p.sku from public.products p where p.id = it.product_id);
      diff := it.counted_quantity - it.expected_quantity;
      select * into cs from public.inventory_cost_state where organization_id = c.organization_id and product_id = it.product_id;
      if diff < 0 then
        val := private.inv_issue_value(cs.quantity_valued, cs.total_value_cents, -diff); pol := 'average'; uc := round(val::numeric / -diff, 4);
        iid := private.inv_add_item(c.organization_id, op, line, it.product_id, -diff, uc, pol, null, 'Falta no inventário');
        perform private.inv_post_move(c.organization_id, op, iid, it.product_id, c.warehouse_id, 'count_out', 'count_difference', diff, -val, uc, pol, null, 'Inventário: ' || c.title, now(), true);
      else
        if it.surplus_unit_cost_cents is not null then
          val := private.inv_entry_value(diff, it.surplus_unit_cost_cents); pol := 'informed'; uc := it.surplus_unit_cost_cents;
        elsif cs.quantity_valued > 0 then
          val := private.inv_round_div(cs.total_value_cents::numeric * (diff * 1000), cs.quantity_valued * 1000); pol := 'average'; uc := round(val::numeric / diff, 4);
        else
          raise exception 'informe o custo da sobra de «%» (não há custo médio para usar)', sku using errcode = '22023';
        end if;
        if cs.total_value_cents + val > 99999999999999 then raise exception 'valor do estoque de «%» acima do limite', sku using errcode = '22023'; end if;
        iid := private.inv_add_item(c.organization_id, op, line, it.product_id, diff, uc, pol, null, 'Sobra no inventário');
        perform private.inv_post_move(c.organization_id, op, iid, it.product_id, c.warehouse_id, 'count_in', 'count_difference', diff, val, uc, pol, null, 'Inventário: ' || c.title, now(), true);
      end if;
      update public.physical_count_items set adjustment_operation_id = op where id = it.id;
    end loop;
    perform private.inv_notify(c.organization_id, 'count_divergence', 'Inventário com divergências', ndiff || ' item(ns) ajustado(s): ' || left(c.title, 200), '/inventarios/' || p_count::text, 'count_div:' || p_count::text, array['owner', 'admin', 'manager']::public.org_role[]);
  end if;
  update public.physical_counts set status = 'completed', completed_at = now(), approved_by = (select auth.uid()) where id = p_count;
  perform private.inv_notify(c.organization_id, 'count_done', 'Inventário concluído', left(c.title, 200), '/inventarios/' || p_count::text, 'count_done:' || p_count::text, array['owner', 'admin', 'manager']::public.org_role[]);
  return op;
end $$;

-- ======================================================================= reposição
-- Parâmetros efetivos de um par produto × depósito: regra do depósito (se ativa) senão padrão do produto. Avalia só pares com saldo registrado.
create function private.inv_effective_params(p_org uuid) returns table (product_id uuid, warehouse_id uuid, quantity numeric, minimum numeric, reorder numeric, target numeric)
language sql stable set search_path = '' as $$
  select b.product_id, b.warehouse_id, b.quantity_on_hand - b.quantity_reserved,
         coalesce(r.minimum_quantity, p.minimum_stock), coalesce(r.reorder_point, p.reorder_point, r.minimum_quantity, p.minimum_stock), coalesce(r.target_quantity, p.target_stock)
  from public.inventory_balances b
  join public.products p on p.id = b.product_id and p.organization_id = b.organization_id and p.archived_at is null and p.status = 'active'
  join public.warehouses w on w.id = b.warehouse_id and w.active
  left join public.reorder_rules r on r.organization_id = b.organization_id and r.product_id = b.product_id and r.warehouse_id = b.warehouse_id and r.enabled
  where b.organization_id = p_org and (r.id is not null or p.minimum_stock is not null or p.reorder_point is not null);
$$;
revoke all on function private.inv_effective_params(uuid) from public, anon, authenticated;

create function private.inv_classify(p_qty numeric, p_min numeric, p_reorder numeric) returns text
language sql immutable set search_path = '' as $$
  select case when p_qty <= 0 then 'out_of_stock'
              when p_min is not null and p_qty <= p_min then 'critical'
              when p_reorder is not null and p_qty <= p_reorder then 'attention'
              else 'normal' end;
$$;

create function public.inv_generate_suggestions(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; k text; sug numeric; last_in timestamptz;
begin
  perform private.inv_guard(p_org, 'operator');
  -- fecha automaticamente as pendentes que deixaram de ser necessárias
  update public.replenishment_suggestions s set status = 'dismissed', reviewed_at = now()
   where s.organization_id = p_org and s.status = 'pending'
     and not exists (select 1 from private.inv_effective_params(p_org) e where e.product_id = s.product_id and e.warehouse_id = s.warehouse_id and private.inv_classify(e.quantity, e.minimum, e.reorder) <> 'normal');
  for r in select e.*, private.inv_classify(e.quantity, e.minimum, e.reorder) as cls from private.inv_effective_params(p_org) e loop
    continue when r.cls = 'normal';
    sug := case when r.target is null then null else greatest(0, r.target - r.quantity) end;
    k := r.cls;
    update public.replenishment_suggestions set suggested_quantity = sug, current_quantity = r.quantity, criterion = k
     where organization_id = p_org and product_id = r.product_id and warehouse_id = r.warehouse_id and status = 'pending';
    if found then continue; end if;
    select max(m.created_at) into last_in from public.stock_movements m where m.organization_id = p_org and m.product_id = r.product_id and m.warehouse_id = r.warehouse_id and m.quantity_delta > 0;
    -- já analisada e nada entrou desde então: não reabre
    continue when exists (select 1 from public.replenishment_suggestions s where s.organization_id = p_org and s.product_id = r.product_id and s.warehouse_id = r.warehouse_id
                          and s.status = 'reviewed' and (last_in is null or s.reviewed_at >= last_in));
    insert into public.replenishment_suggestions (organization_id, product_id, warehouse_id, suggested_quantity, current_quantity, criterion) values (p_org, r.product_id, r.warehouse_id, sug, r.quantity, k);
    n := n + 1;
  end loop;
  if n > 0 then
    perform private.inv_notify(p_org, 'replenishment', 'Reposição sugerida', n || ' produto(s) pedem análise de reposição', '/reposicao', 'repl:' || p_org::text || ':' || private.inv_today(p_org)::text, array['owner', 'admin', 'manager']::public.org_role[]);
  end if;
  return n;
end $$;

create function public.inv_review_suggestion(p_id uuid, p_status text, p_quantity numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.replenishment_suggestions%rowtype;
begin
  select * into s from public.replenishment_suggestions where id = p_id for update;
  if not found then raise exception 'sugestão não encontrada' using errcode = '22023'; end if;
  perform private.inv_guard(s.organization_id, 'manager');
  if p_status not in ('reviewed', 'dismissed') then raise exception 'situação inválida' using errcode = '22023'; end if;
  if s.status <> 'pending' then raise exception 'sugestão já tratada' using errcode = '55000'; end if;
  if p_quantity is not null and (p_quantity < 0 or p_quantity >= 1000000000000) then raise exception 'quantidade inválida' using errcode = '22023'; end if;
  update public.replenishment_suggestions set status = p_status, reviewed_by = (select auth.uid()), reviewed_at = now(), suggested_quantity = coalesce(p_quantity, suggested_quantity) where id = p_id;
end $$;

-- Gera avisos de estoque (abaixo do mínimo, zerado, produto parado). Idempotente por dia.
create function public.inv_run_routines(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; today_ date; sug integer; notes integer := 0; idle integer; days_ integer; roles_ public.org_role[] := array['owner', 'admin', 'manager']::public.org_role[];
begin
  perform private.inv_guard(p_org, 'operator');
  today_ := private.inv_today(p_org);
  sug := public.inv_generate_suggestions(p_org);
  for r in select e.*, private.inv_classify(e.quantity, e.minimum, e.reorder) as cls, p.sku, p.name from private.inv_effective_params(p_org) e join public.products p on p.id = e.product_id loop
    if r.cls = 'out_of_stock' then
      notes := notes + private.inv_notify(p_org, 'out_of_stock', 'Produto sem estoque', left(r.sku || ' — ' || r.name, 200), '/saldos', 'oos:' || r.product_id::text || ':' || r.warehouse_id::text || ':' || today_::text, roles_);
    elsif r.cls = 'critical' then
      notes := notes + private.inv_notify(p_org, 'below_minimum', 'Estoque abaixo do mínimo', left(r.sku || ' — ' || r.name, 200), '/reposicao', 'min:' || r.product_id::text || ':' || r.warehouse_id::text || ':' || today_::text, roles_);
    end if;
  end loop;
  return jsonb_build_object('suggestions', sug, 'notifications', notes);
end $$;

-- ======================================================================= privilégios
do $$
declare f text;
begin
  foreach f in array array[
    'public.inv_mark_notifications_read(uuid, uuid[])', 'public.inv_set_notification_pref(uuid, text, boolean)',
    'public.inv_create_count(uuid, uuid, text, uuid[], text)', 'public.inv_count_add_product(uuid, uuid)', 'public.inv_count_record(uuid, numeric, text)',
    'public.inv_submit_count(uuid)', 'public.inv_reopen_stale_count(uuid)', 'public.inv_count_set_surplus_cost(uuid, numeric)', 'public.inv_cancel_count(uuid, text)',
    'public.inv_approve_count(uuid)', 'public.inv_generate_suggestions(uuid)', 'public.inv_review_suggestion(uuid, text, numeric)', 'public.inv_run_routines(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- auditoria dos inventários (metadados) e gatilho de updated_at já cobertos pelo Core onde aplicável
create trigger audit_physical_counts after insert or update on public.physical_counts for each row execute function private.audit_trigger('organization_id', 'id');

commit;
