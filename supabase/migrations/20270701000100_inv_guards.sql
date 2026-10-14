-- Controle de Estoque Inteligente — GUARDAS (parte 2): helpers, gatilhos de integridade e imutabilidade, padrões por empresa.

begin;
set local check_function_bodies = off;

-- ======================================================================= helpers
create function private.inv_tz(org uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce((select s.timezone from public.inv_settings s where s.organization_id = org), 'America/Sao_Paulo');
$$;
create function private.inv_today(org uuid) returns date
language sql stable set search_path = '' as $$ select (now() at time zone private.inv_tz(org))::date; $$;

create function private.inv_brl(p_cents bigint) returns text
language sql immutable set search_path = '' as $$
  select case when p_cents < 0 then '-' else '' end || 'R$ ' || (abs(p_cents) / 100)::text || ',' || lpad((abs(p_cents) % 100)::text, 2, '0');
$$;

-- Quantidade para mensagens: sem zeros à direita, vírgula decimal.
create function private.inv_qty(p_q numeric) returns text
language sql immutable set search_path = '' as $$ select replace(trim_scale(p_q)::text, '.', ','); $$;

-- Divisão inteira com arredondamento meio-para-o-par. Numerador e denominador são INTEIROS (numeric), n >= 0, d > 0.
create function private.inv_round_div(n numeric, d numeric) returns bigint
language plpgsql immutable set search_path = '' as $$
declare q numeric; r numeric;
begin
  if n is null or d is null or d <= 0 or n < 0 then return null; end if;
  q := div(n, d); r := mod(n, d);
  if 2 * r > d or (2 * r = d and mod(q, 2) = 1) then q := q + 1; end if;
  return q::bigint;
end $$;

-- Dígito verificador de EAN-13, EAN-8 e UPC-A (pesos 3,1 da direita para a esquerda, sem o dígito de controle).
create function private.inv_gtin_ok(p_code text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare s integer := 0; i integer; n integer := char_length(p_code); w integer;
begin
  if p_code !~ '^[0-9]+$' then return null; end if;           -- não é numérico: código interno
  if n not in (8, 12, 13) then return false; end if;
  for i in 1 .. n - 1 loop
    w := case when (n - i) % 2 = 1 then 3 else 1 end;
    s := s + substr(p_code, i, 1)::integer * w;
  end loop;
  return ((10 - s % 10) % 10) = substr(p_code, n, 1)::integer;
end $$;

create function private.inv_guard(p_org uuid, p_level text, p_wh uuid default null) returns void
language plpgsql stable security definer set search_path = '' as $$
declare ok boolean;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
  ok := case p_level when 'admin' then private.inv_is_admin(p_org) when 'manager' then private.inv_is_manager(p_org)
                     when 'operator' then private.inv_is_operator(p_org) else private.inv_can_read(p_org) end;
  if not ok then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_wh is not null and p_level <> 'read' and not private.inv_wh_allowed(p_org, p_wh) then
    raise exception 'sem permissão neste depósito' using errcode = '42501';
  end if;
end $$;
revoke all on function private.inv_guard(uuid, text, uuid) from public, anon;
grant execute on function private.inv_guard(uuid, text, uuid) to authenticated;

-- ======================================================================= padrões por empresa (configurações e unidades iniciais)
create function private.inv_bootstrap_org(org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inv_settings (organization_id) values (org) on conflict do nothing;
  insert into public.units_of_measure (organization_id, symbol, name, decimal_places) values
    (org, 'un', 'Unidade', 0), (org, 'cx', 'Caixa', 0), (org, 'pct', 'Pacote', 0),
    (org, 'kg', 'Quilograma', 3), (org, 'L', 'Litro', 3), (org, 'm', 'Metro', 3)
  on conflict do nothing;
end $$;
revoke all on function private.inv_bootstrap_org(uuid) from public, anon, authenticated;
create function private.inv_on_org_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.inv_bootstrap_org(new.id); return null; end $$;
revoke all on function private.inv_on_org_created() from public, anon, authenticated;
create trigger inv_on_org_created after insert on public.organizations for each row execute function private.inv_on_org_created();
select private.inv_bootstrap_org(id) from public.organizations;

-- ======================================================================= updated_at e auditoria (só metadados do cadastro)
do $$
declare t text;
begin
  foreach t in array array['suppliers', 'products', 'warehouses', 'inv_settings', 'reorder_rules'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', 'upd_' || t, t);
  end loop;
  foreach t in array array['units_of_measure', 'product_categories', 'suppliers', 'products', 'product_suppliers', 'warehouses', 'warehouse_locations', 'inv_settings', 'reorder_rules'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)',
      'audit_' || t, t, 'organization_id', case t when 'inv_settings' then 'organization_id' else 'id' end);
  end loop;
end $$;

-- ======================================================================= imutabilidade (vale até para o dono do schema)
create function private.inv_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registros de estoque não podem ser apagados (histórico preservado): %', tg_table_name using errcode = '23514'; end $$;
create function private.inv_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro imutável: % (corrija por estorno ou ajuste compensatório)', tg_table_name using errcode = '23514'; end $$;
revoke all on function private.inv_no_delete() from public, anon, authenticated;
revoke all on function private.inv_append_only() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['units_of_measure', 'product_categories', 'suppliers', 'products', 'warehouses', 'warehouse_locations', 'stock_operations', 'stock_operation_items',
    'inventory_balances', 'inventory_cost_state', 'physical_counts', 'physical_count_items', 'replenishment_suggestions'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.inv_no_delete()', 'nodel_' || t, t);
  end loop;
  foreach t in array array['stock_movements', 'inventory_cost_events', 'stock_operation_items'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.inv_append_only()', 'append_' || t, t);
  end loop;
end $$;

-- A operação só muda de «confirmada» para «estornada» (uma vez); nada mais é editável.
create function private.inv_operation_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'confirmed' and new.status = 'reversed'
     and (to_jsonb(new) - 'status' - 'reversed_at' - 'reversed_by') = (to_jsonb(old) - 'status' - 'reversed_at' - 'reversed_by') then
    return new;
  end if;
  raise exception 'operação de estoque confirmada é imutável (só pode ser estornada)' using errcode = '23514';
end $$;
revoke all on function private.inv_operation_guard() from public, anon, authenticated;
create trigger operation_guard before update on public.stock_operations for each row execute function private.inv_operation_guard();

-- ======================================================================= regras de cadastro
create function private.inv_product_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare g boolean; mgr boolean; stock numeric; moved boolean;
begin
  mgr := private.inv_is_manager(new.organization_id) or (select auth.uid()) is null;   -- chamadas internas (sem sessão) não são operador
  if new.barcode is not null then
    g := private.inv_gtin_ok(new.barcode);
    if g is false then raise exception 'código de barras inválido: números devem ter 8, 12 ou 13 dígitos com dígito verificador correto (EAN-8, UPC-A, EAN-13); para código interno use letras (ex.: INT-0001)' using errcode = '23514'; end if;
  end if;
  if tg_op = 'INSERT' then
    if not mgr and (new.minimum_stock is not null or new.reorder_point is not null or new.target_stock is not null or new.default_supplier_id is not null) then
      raise exception 'operador não define parâmetros de reposição nem fornecedor principal' using errcode = '42501';
    end if;
    perform 1 from public.units_of_measure u where u.id = new.unit_id and u.organization_id = new.organization_id and u.active;
    if not found then raise exception 'unidade de medida inativa' using errcode = '23514'; end if;
    return new;
  end if;
  if not mgr and (new.minimum_stock is distinct from old.minimum_stock or new.reorder_point is distinct from old.reorder_point or new.target_stock is distinct from old.target_stock
                  or new.default_supplier_id is distinct from old.default_supplier_id or new.archived_at is distinct from old.archived_at or new.status is distinct from old.status) then
    raise exception 'operador não altera reposição, fornecedor principal, situação nem arquiva' using errcode = '42501';
  end if;
  if new.unit_id <> old.unit_id then
    select exists (select 1 from public.stock_movements m where m.product_id = old.id) into moved;
    if moved then raise exception 'a unidade de medida não muda depois da primeira movimentação' using errcode = '23514'; end if;
  end if;
  if new.archived_at is not null and old.archived_at is null then
    select coalesce(sum(b.quantity_on_hand), 0) into stock from public.inventory_balances b where b.product_id = old.id;
    if stock <> 0 then raise exception 'produto com saldo em estoque não pode ser arquivado (zere o saldo antes)' using errcode = '55000'; end if;
  end if;
  return new;
end $$;
revoke all on function private.inv_product_guard() from public, anon, authenticated;
create trigger product_guard before insert or update on public.products for each row execute function private.inv_product_guard();

create function private.inv_warehouse_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare stock numeric;
begin
  if tg_op = 'UPDATE' and old.active and not new.active then
    select coalesce(sum(b.quantity_on_hand), 0) into stock from public.inventory_balances b where b.warehouse_id = old.id;
    if stock <> 0 then raise exception 'depósito com saldo não pode ser arquivado (transfira ou ajuste o estoque antes)' using errcode = '55000'; end if;
    if exists (select 1 from public.physical_counts c where c.warehouse_id = old.id and c.status in ('counting', 'awaiting_approval')) then
      raise exception 'depósito com inventário em andamento não pode ser arquivado' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.inv_warehouse_guard() from public, anon, authenticated;
create trigger warehouse_guard before update on public.warehouses for each row execute function private.inv_warehouse_guard();

create function private.inv_category_guard() returns trigger language plpgsql set search_path = '' as $$
declare cur uuid; depth integer := 0;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'categoria não pode ser pai de si mesma' using errcode = '23514'; end if;
  cur := new.parent_id;
  while cur is not null loop
    depth := depth + 1;
    if depth > 3 then raise exception 'no máximo 4 níveis de categorias' using errcode = '23514'; end if;
    if cur = new.id then raise exception 'ciclo na hierarquia de categorias' using errcode = '23514'; end if;
    select c.parent_id into cur from public.product_categories c where c.id = cur and c.organization_id = new.organization_id;
  end loop;
  return new;
end $$;
revoke all on function private.inv_category_guard() from public, anon, authenticated;
create trigger category_guard before insert or update on public.product_categories for each row execute function private.inv_category_guard();

create function private.inv_access_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organization_members m where m.organization_id = new.organization_id and m.user_id = new.user_id and m.role = 'member') then
    raise exception 'depósitos autorizados só se aplicam a operadores da empresa' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.inv_access_guard() from public, anon, authenticated;
create trigger access_guard before insert on public.warehouse_access for each row execute function private.inv_access_guard();

-- Fornecedor principal do produto precisa estar ativo (histórico de movimentos não depende dele).
create function private.inv_rule_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.products p where p.id = new.product_id and p.organization_id = new.organization_id and p.archived_at is null) then
    raise exception 'produto arquivado não recebe regra de reposição' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.inv_rule_guard() from public, anon, authenticated;
create trigger rule_guard before insert on public.reorder_rules for each row execute function private.inv_rule_guard();

commit;
