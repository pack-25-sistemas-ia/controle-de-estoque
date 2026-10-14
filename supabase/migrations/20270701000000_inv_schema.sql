-- Controle de Estoque Inteligente — ESQUEMA (parte 1): tabelas, helpers de papel, RLS, privilégios e imutabilidade.
-- Fonte de verdade: livro stock_movements (só-acréscimo). inventory_balances e inventory_cost_state são derivados e só as funções inv_* os escrevem.
-- Quantidade: numeric(18,3). Dinheiro: centavos (bigint). Valor acumulado do estoque em centavos inteiros (docs/COSTING_RULES.md).
-- Catálogos simples (produtos, categorias, unidades, fornecedores, depósitos) por RLS com privilégios por coluna; tudo que move estoque, só por função.

begin;
set local check_function_bodies = off;

create type public.inv_product_type as enum ('merchandise', 'raw_material', 'supply', 'consumable', 'other');
create type public.inv_op_type as enum ('entry', 'issue', 'transfer', 'adjustment', 'opening', 'count_adjustment', 'reversal');
create type public.inv_move_type as enum ('entry', 'issue', 'transfer_out', 'transfer_in', 'adjustment_in', 'adjustment_out', 'opening', 'count_in', 'count_out', 'reversal');
create type public.inv_count_status as enum ('draft', 'counting', 'awaiting_approval', 'completed', 'cancelled');

-- ======================================================================= helpers de autorização
-- Perfis: owner/admin = Administrador · manager = Gestor de estoque · member = Operador · viewer = Consulta.
create function private.inv_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;
create function private.inv_can_read(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.inv_role(org) is not null; $$;
create function private.inv_is_operator(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.inv_role(org) in ('owner', 'admin', 'manager', 'member'), false); $$;
create function private.inv_is_manager(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.inv_role(org) in ('owner', 'admin', 'manager'), false); $$;
create function private.inv_is_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.inv_role(org) in ('owner', 'admin'), false); $$;

-- Depósito permitido: administrador e gestor sempre; operador só nos depósitos autorizados (sem linhas = todos); consulta nunca opera.
create function private.inv_wh_allowed(org uuid, wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.inv_role(org)
    when 'owner' then true when 'admin' then true when 'manager' then true
    when 'member' then (not exists (select 1 from public.warehouse_access a where a.organization_id = org and a.user_id = (select auth.uid()))
                        or exists (select 1 from public.warehouse_access a where a.organization_id = org and a.user_id = (select auth.uid()) and a.warehouse_id = wh))
    else false end;
$$;

do $$
declare f text;
begin
  foreach f in array array['private.inv_role(uuid)', 'private.inv_can_read(uuid)', 'private.inv_is_operator(uuid)', 'private.inv_is_manager(uuid)', 'private.inv_is_admin(uuid)', 'private.inv_wh_allowed(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= configurações por empresa
create table public.inv_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  idle_days integer not null default 90 check (idle_days between 7 and 730),
  coverage_window_days integer not null default 30 check (coverage_window_days between 7 and 365),
  label_company_name boolean not null default true,
  label_show_price boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ======================================================================= cadastros
create table public.units_of_measure (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  symbol text not null check (char_length(trim(symbol)) between 1 and 8),
  name text not null check (char_length(trim(name)) between 1 and 40),
  decimal_places smallint not null default 0 check (decimal_places between 0 and 3),
  allows_fraction boolean generated always as (decimal_places > 0) stored,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index units_symbol_uniq on public.units_of_measure (organization_id, lower(symbol));

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (parent_id, organization_id) references public.product_categories (id, organization_id)
);
create unique index categories_name_uniq on public.product_categories (organization_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  legal_name text check (legal_name is null or char_length(legal_name) <= 160),
  document_number text check (document_number is null or char_length(document_number) <= 20),
  email text check (email is null or (char_length(email) <= 160 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or char_length(phone) <= 30),
  lead_time_days integer check (lead_time_days is null or lead_time_days between 0 and 365),
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index suppliers_name_uniq on public.suppliers (organization_id, lower(name));

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid,
  unit_id uuid not null,
  sku text not null check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
  barcode text check (barcode is null or barcode ~ '^[A-Za-z0-9._-]{3,48}$'),
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text check (description is null or char_length(description) <= 1000),
  image_path text check (image_path is null or char_length(image_path) <= 300),
  list_price_cents bigint check (list_price_cents is null or (list_price_cents >= 0 and list_price_cents <= 99999999999999)),
  product_type public.inv_product_type not null default 'merchandise',
  status text not null default 'active' check (status in ('active', 'inactive')),
  minimum_stock numeric(18,3) check (minimum_stock is null or minimum_stock >= 0),
  reorder_point numeric(18,3) check (reorder_point is null or reorder_point >= 0),
  target_stock numeric(18,3) check (target_stock is null or target_stock >= 0),
  default_supplier_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (category_id, organization_id) references public.product_categories (id, organization_id),
  foreign key (unit_id, organization_id) references public.units_of_measure (id, organization_id),
  foreign key (default_supplier_id, organization_id) references public.suppliers (id, organization_id),
  check (minimum_stock is null or reorder_point is null or minimum_stock <= reorder_point),
  check (reorder_point is null or target_stock is null or reorder_point <= target_stock),
  check (minimum_stock is null or target_stock is null or minimum_stock <= target_stock)
);
create unique index products_sku_uniq on public.products (organization_id, lower(sku));
create unique index products_barcode_uniq on public.products (organization_id, lower(barcode)) where barcode is not null;
create index products_cat_idx on public.products (organization_id, category_id);
create index products_name_idx on public.products (organization_id, lower(name));

create table public.product_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  supplier_id uuid not null,
  supplier_sku text check (supplier_sku is null or char_length(supplier_sku) <= 60),
  last_purchase_cost_cents numeric(20,4) check (last_purchase_cost_cents is null or last_purchase_cost_cents >= 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days between 0 and 365),
  is_preferred boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, supplier_id),
  foreign key (product_id, organization_id) references public.products (id, organization_id),
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id)
);
create unique index product_suppliers_pref_uniq on public.product_suppliers (product_id) where is_preferred;

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  description text check (description is null or char_length(description) <= 300),
  address text check (address is null or char_length(address) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index warehouses_code_uniq on public.warehouses (organization_id, lower(code));
create unique index warehouses_name_uniq on public.warehouses (organization_id, lower(name));

create table public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null,
  parent_id uuid,
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (warehouse_id, organization_id) references public.warehouses (id, organization_id),
  foreign key (parent_id, organization_id) references public.warehouse_locations (id, organization_id)
);
create unique index locations_code_uniq on public.warehouse_locations (warehouse_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code));

-- Depósitos autorizados por operador (sem FK para organization_members: evita o embed ambíguo PGRST201 do Core).
create table public.warehouse_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  warehouse_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, warehouse_id),
  foreign key (warehouse_id, organization_id) references public.warehouses (id, organization_id)
);

-- ======================================================================= operações, livro, saldos e custo
-- Número de operação: sequência GLOBAL (sem trava); a numeração exibida por empresa é calculada na visão inv_operations_view.
-- Um contador por empresa seria uma linha quente que serializaria TODAS as operações da empresa.
create sequence public.inv_op_seq;
revoke all on sequence public.inv_op_seq from public, anon, authenticated;

create table public.stock_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  op_number bigint not null,
  operation_type public.inv_op_type not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  reason_code text check (reason_code is null or reason_code ~ '^[a-z_]{3,30}$'),
  warehouse_id uuid,
  source_warehouse_id uuid,
  destination_warehouse_id uuid,
  supplier_id uuid,
  external_reference text check (external_reference is null or char_length(external_reference) <= 60),
  notes text check (notes is null or char_length(notes) <= 500),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  count_id uuid,
  reversal_of_operation_id uuid,
  reversal_reason text,
  created_by uuid not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid,
  unique (id, organization_id),
  unique (organization_id, op_number),
  unique (organization_id, idempotency_key),
  foreign key (warehouse_id, organization_id) references public.warehouses (id, organization_id),
  foreign key (source_warehouse_id, organization_id) references public.warehouses (id, organization_id),
  foreign key (destination_warehouse_id, organization_id) references public.warehouses (id, organization_id),
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id),
  foreign key (reversal_of_operation_id, organization_id) references public.stock_operations (id, organization_id),
  check ((status = 'reversed') = (reversed_at is not null)),
  check (operation_type <> 'transfer' or (source_warehouse_id is not null and destination_warehouse_id is not null and source_warehouse_id <> destination_warehouse_id)),
  check (operation_type = 'transfer' or warehouse_id is not null),
  check ((operation_type = 'reversal') = (reversal_of_operation_id is not null))
);
create unique index operations_reversal_uniq on public.stock_operations (reversal_of_operation_id) where reversal_of_operation_id is not null;
create index operations_recent_idx on public.stock_operations (organization_id, occurred_at desc);

create table public.stock_operation_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_id uuid not null,
  line_no integer not null check (line_no >= 1),
  product_id uuid not null,
  quantity numeric(18,3) not null check (quantity > 0 and quantity < 1000000000000),
  unit_cost_cents numeric(20,4) check (unit_cost_cents is null or (unit_cost_cents >= 0 and unit_cost_cents < 100000000000000)),
  cost_policy text check (cost_policy is null or cost_policy in ('informed', 'average', 'original', 'none')),
  reference_movement_id uuid,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (operation_id, line_no),
  unique (operation_id, product_id),
  foreign key (operation_id, organization_id) references public.stock_operations (id, organization_id),
  foreign key (product_id, organization_id) references public.products (id, organization_id)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_id uuid not null,
  item_id uuid not null,
  product_id uuid not null,
  warehouse_id uuid not null,
  movement_type public.inv_move_type not null,
  reason_code text check (reason_code is null or reason_code ~ '^[a-z_]{3,30}$'),
  quantity_delta numeric(18,3) not null check (quantity_delta <> 0 and abs(quantity_delta) < 1000000000000),
  value_delta_cents bigint not null check (abs(value_delta_cents) <= 99999999999999),
  unit_cost_cents numeric(20,4) check (unit_cost_cents is null or unit_cost_cents >= 0),
  cost_policy text check (cost_policy is null or cost_policy in ('informed', 'average', 'original', 'none')),
  balance_after numeric(18,3) not null check (balance_after >= 0),
  reverses_movement_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  performed_by uuid not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (operation_id, item_id, warehouse_id, movement_type),
  foreign key (operation_id, organization_id) references public.stock_operations (id, organization_id),
  foreign key (item_id, organization_id) references public.stock_operation_items (id, organization_id),
  foreign key (product_id, organization_id) references public.products (id, organization_id),
  foreign key (warehouse_id, organization_id) references public.warehouses (id, organization_id),
  foreign key (reverses_movement_id, organization_id) references public.stock_movements (id, organization_id),
  check (sign(value_delta_cents) in (0, sign(quantity_delta)))
);
create unique index movements_reverses_uniq on public.stock_movements (reverses_movement_id) where reverses_movement_id is not null;
create index movements_pw_idx on public.stock_movements (organization_id, product_id, warehouse_id, occurred_at, created_at);
create index movements_op_idx on public.stock_movements (organization_id, operation_id);
create index movements_time_idx on public.stock_movements (organization_id, occurred_at desc);

create table public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  warehouse_id uuid not null,
  quantity_on_hand numeric(18,3) not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved numeric(18,3) not null default 0 check (quantity_reserved = 0),
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (organization_id, product_id, warehouse_id),
  foreign key (product_id, organization_id) references public.products (id, organization_id),
  foreign key (warehouse_id, organization_id) references public.warehouses (id, organization_id)
);
create index balances_wh_idx on public.inventory_balances (organization_id, warehouse_id);

create table public.inventory_cost_state (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  quantity_valued numeric(18,3) not null default 0 check (quantity_valued >= 0),
  total_value_cents bigint not null default 0 check (total_value_cents >= 0 and total_value_cents <= 99999999999999),
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, product_id),
  foreign key (product_id, organization_id) references public.products (id, organization_id),
  check (quantity_valued > 0 or total_value_cents = 0)
);

create table public.inventory_cost_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  movement_id uuid not null,
  quantity_delta numeric(18,3) not null,
  value_delta_cents bigint not null,
  quantity_before numeric(18,3) not null,
  quantity_after numeric(18,3) not null,
  value_before_cents bigint not null,
  value_after_cents bigint not null,
  average_cost_before numeric(20,4),
  average_cost_after numeric(20,4),
  created_at timestamptz not null default now(),
  unique (movement_id),
  foreign key (product_id, organization_id) references public.products (id, organization_id),
  foreign key (movement_id, organization_id) references public.stock_movements (id, organization_id)
);
create index cost_events_product_idx on public.inventory_cost_events (organization_id, product_id, created_at);

-- ======================================================================= inventário físico
create table public.physical_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  status public.inv_count_status not null default 'draft',
  notes text check (notes is null or char_length(notes) <= 500),
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null,
  approved_by uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (warehouse_id, organization_id) references public.warehouses (id, organization_id)
);
create index counts_wh_idx on public.physical_counts (organization_id, warehouse_id, status);

create table public.physical_count_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  count_id uuid not null,
  product_id uuid not null,
  expected_quantity numeric(18,3) not null check (expected_quantity >= 0),
  counted_quantity numeric(18,3) check (counted_quantity is null or counted_quantity >= 0),
  balance_version_at_snapshot bigint not null,
  counted_by uuid,
  counted_at timestamptz,
  note text check (note is null or char_length(note) <= 300),
  surplus_unit_cost_cents numeric(20,4) check (surplus_unit_cost_cents is null or surplus_unit_cost_cents >= 0),
  adjustment_operation_id uuid,
  unique (count_id, product_id),
  foreign key (count_id, organization_id) references public.physical_counts (id, organization_id),
  foreign key (product_id, organization_id) references public.products (id, organization_id),
  foreign key (adjustment_operation_id, organization_id) references public.stock_operations (id, organization_id)
);

-- ======================================================================= reposição
create table public.reorder_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  warehouse_id uuid,
  minimum_quantity numeric(18,3) not null check (minimum_quantity >= 0),
  reorder_point numeric(18,3) not null check (reorder_point >= 0),
  target_quantity numeric(18,3) check (target_quantity is null or target_quantity >= 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days between 0 and 365),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  foreign key (product_id, organization_id) references public.products (id, organization_id),
  foreign key (warehouse_id, organization_id) references public.warehouses (id, organization_id),
  check (minimum_quantity <= reorder_point),
  check (target_quantity is null or reorder_point <= target_quantity)
);
create unique index reorder_rules_uniq on public.reorder_rules (organization_id, product_id, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.replenishment_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  warehouse_id uuid not null,
  suggested_quantity numeric(18,3) check (suggested_quantity is null or suggested_quantity >= 0),
  current_quantity numeric(18,3) not null check (current_quantity >= 0),
  criterion text not null check (criterion in ('out_of_stock', 'critical', 'attention')),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  generated_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  foreign key (product_id, organization_id) references public.products (id, organization_id),
  foreign key (warehouse_id, organization_id) references public.warehouses (id, organization_id),
  check ((status = 'pending') = (reviewed_at is null))
);
create unique index suggestions_pending_uniq on public.replenishment_suggestions (organization_id, product_id, warehouse_id) where status = 'pending';

-- ======================================================================= RLS e privilégios
do $$
declare t text;
begin
  foreach t in array array['inv_settings', 'units_of_measure', 'product_categories', 'suppliers', 'products', 'product_suppliers', 'warehouses', 'warehouse_locations',
    'warehouse_access', 'stock_operations', 'stock_operation_items', 'stock_movements', 'inventory_balances', 'inventory_cost_state', 'inventory_cost_events',
    'physical_counts', 'physical_count_items', 'reorder_rules', 'replenishment_suggestions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.inv_can_read(organization_id))', t || '_select', t);
  end loop;
end $$;

-- Cadastros: escrita direta por RLS + privilégio por coluna. Regras finas (operador, unidade com histórico) ficam em gatilhos.
grant insert (organization_id, symbol, name, decimal_places), update (symbol, name, active) on public.units_of_measure to authenticated;
create policy units_insert on public.units_of_measure for insert to authenticated with check (private.inv_is_manager(organization_id));
create policy units_update on public.units_of_measure for update to authenticated using (private.inv_is_manager(organization_id)) with check (private.inv_is_manager(organization_id));

grant insert (organization_id, parent_id, name, description), update (name, description, active, parent_id) on public.product_categories to authenticated;
create policy categories_insert on public.product_categories for insert to authenticated with check (private.inv_is_manager(organization_id));
create policy categories_update on public.product_categories for update to authenticated using (private.inv_is_manager(organization_id)) with check (private.inv_is_manager(organization_id));

grant insert (organization_id, name, legal_name, document_number, email, phone, lead_time_days, notes), update (name, legal_name, document_number, email, phone, lead_time_days, notes, active) on public.suppliers to authenticated;
create policy suppliers_insert on public.suppliers for insert to authenticated with check (private.inv_is_manager(organization_id));
create policy suppliers_update on public.suppliers for update to authenticated using (private.inv_is_manager(organization_id)) with check (private.inv_is_manager(organization_id));

grant insert (organization_id, category_id, unit_id, sku, barcode, name, description, product_type, list_price_cents, minimum_stock, reorder_point, target_stock, default_supplier_id),
      update (category_id, unit_id, sku, barcode, name, description, product_type, list_price_cents, status, minimum_stock, reorder_point, target_stock, default_supplier_id, archived_at) on public.products to authenticated;
create policy products_insert on public.products for insert to authenticated with check (private.inv_is_operator(organization_id));
create policy products_update on public.products for update to authenticated using (private.inv_is_operator(organization_id)) with check (private.inv_is_operator(organization_id));

grant insert (organization_id, product_id, supplier_id, supplier_sku, last_purchase_cost_cents, lead_time_days, is_preferred), update (supplier_sku, last_purchase_cost_cents, lead_time_days, is_preferred) on public.product_suppliers to authenticated;
grant delete on public.product_suppliers to authenticated;
create policy product_suppliers_insert on public.product_suppliers for insert to authenticated with check (private.inv_is_manager(organization_id));
create policy product_suppliers_update on public.product_suppliers for update to authenticated using (private.inv_is_manager(organization_id)) with check (private.inv_is_manager(organization_id));
create policy product_suppliers_delete on public.product_suppliers for delete to authenticated using (private.inv_is_manager(organization_id));

grant insert (organization_id, name, code, description, address), update (name, code, description, address, active) on public.warehouses to authenticated;
create policy warehouses_insert on public.warehouses for insert to authenticated with check (private.inv_is_manager(organization_id));
create policy warehouses_update on public.warehouses for update to authenticated using (private.inv_is_manager(organization_id)) with check (private.inv_is_manager(organization_id));

grant insert (organization_id, warehouse_id, parent_id, code, name), update (code, name, active) on public.warehouse_locations to authenticated;
create policy locations_insert on public.warehouse_locations for insert to authenticated with check (private.inv_is_manager(organization_id));
create policy locations_update on public.warehouse_locations for update to authenticated using (private.inv_is_manager(organization_id)) with check (private.inv_is_manager(organization_id));

grant insert (organization_id, user_id, warehouse_id), delete on public.warehouse_access to authenticated;
create policy warehouse_access_insert on public.warehouse_access for insert to authenticated with check (private.inv_is_admin(organization_id));
create policy warehouse_access_delete on public.warehouse_access for delete to authenticated using (private.inv_is_admin(organization_id));

grant update (timezone, idle_days, coverage_window_days, label_company_name, label_show_price) on public.inv_settings to authenticated;
create policy inv_settings_update on public.inv_settings for update to authenticated using (private.inv_is_admin(organization_id)) with check (private.inv_is_admin(organization_id));

grant insert (organization_id, product_id, warehouse_id, minimum_quantity, reorder_point, target_quantity, lead_time_days, enabled), update (minimum_quantity, reorder_point, target_quantity, lead_time_days, enabled) on public.reorder_rules to authenticated;
grant delete on public.reorder_rules to authenticated;
create policy reorder_insert on public.reorder_rules for insert to authenticated with check (private.inv_is_manager(organization_id));
create policy reorder_update on public.reorder_rules for update to authenticated using (private.inv_is_manager(organization_id)) with check (private.inv_is_manager(organization_id));
create policy reorder_delete on public.reorder_rules for delete to authenticated using (private.inv_is_manager(organization_id));

-- MFA no banco (mesma regra do Core): sem AAL2 não escreve, nem pela API REST direta.
do $$
declare t text;
begin
  foreach t in array array['units_of_measure', 'product_categories', 'suppliers', 'products', 'product_suppliers', 'warehouses', 'warehouse_locations', 'warehouse_access', 'inv_settings', 'reorder_rules'] loop
    if t in ('warehouse_access', 'product_suppliers', 'reorder_rules') then
      execute format('create policy mfa_delete on public.%I as restrictive for delete to authenticated using (private.mfa_ok())', t);
    end if;
    if t not in ('warehouse_access') then
      execute format('create policy mfa_update on public.%I as restrictive for update to authenticated using (private.mfa_ok()) with check (private.mfa_ok())', t);
    end if;
    if t <> 'inv_settings' then
      execute format('create policy mfa_insert on public.%I as restrictive for insert to authenticated with check (private.mfa_ok())', t);
    end if;
  end loop;
end $$;

commit;
