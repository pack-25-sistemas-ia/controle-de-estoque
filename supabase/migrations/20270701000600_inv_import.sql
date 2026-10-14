-- Controle de Estoque Inteligente — IMPORTAÇÃO DE CSV (parte 7): prévia que valida cada linha → confirmação atômica.
-- Tipos: products, suppliers, categories, opening (saldo inicial, vira movimento de abertura), reorder (regras de reposição).
-- O navegador/servidor lê e normaliza o CSV (separador, vírgula decimal, custo em centavos); o BANCO valida de verdade e decide o que entra.
-- Nunca substitui saldo: saldo inicial passa por inv_post_opening (livro, custo, auditoria, uma vez por produto × depósito).

begin;
set local check_function_bodies = off;

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_type text not null check (import_type in ('products', 'suppliers', 'categories', 'opening', 'reorder')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'previewed' check (status in ('previewed', 'completed', 'cancelled')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  error_rows integer not null default 0,
  accepted_rows integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, organization_id),
  check ((status = 'completed') = (completed_at is not null))
);
create unique index import_jobs_done_uniq on public.import_jobs (organization_id, import_type, file_hash) where status = 'completed';

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  row_number integer not null check (row_number >= 1),
  status text not null check (status in ('valid', 'duplicate', 'error', 'imported')),
  parsed_data jsonb not null,
  error_message text check (error_message is null or char_length(error_message) <= 300),
  natural_key text,
  unique (job_id, row_number),
  foreign key (job_id, organization_id) references public.import_jobs (id, organization_id)
);

do $$
declare t text;
begin
  foreach t in array array['import_jobs', 'import_rows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.inv_can_read(organization_id))', t || '_select', t);
  end loop;
end $$;
create trigger nodel_import_jobs before delete on public.import_jobs for each row execute function private.inv_no_delete();
create trigger nodel_import_rows before delete on public.import_rows for each row execute function private.inv_no_delete();

-- Numérico opcional vindo do JSON (texto com ponto decimal já normalizado pelo servidor).
create function private.inv_num(p_row jsonb, p_key text, p_label text, p_min numeric default 0, p_max numeric default 999999999999) returns numeric
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(trim(p_row ->> p_key), ''); n numeric;
begin
  if v is null then return null; end if;
  begin n := v::numeric; exception when others then raise exception '% inválido: «%»', p_label, left(v, 30) using errcode = '22023'; end;
  if n < p_min or n > p_max then raise exception '% fora do intervalo permitido', p_label using errcode = '22023'; end if;
  return n;
end $$;

create function public.inv_create_import(p_org uuid, p_type text, p_file_name text, p_file_hash text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job uuid; ex public.import_jobs%rowtype; r jsonb; n integer := 0; nv integer := 0; nd integer := 0; ne integer := 0; st text; msg text; nk text; seen text[] := '{}';
  lvl text; mgr boolean; v_sku text; wid uuid; pid uuid; u public.units_of_measure%rowtype; mn numeric; rp numeric; tg numeric; cat_n integer; q numeric; cost numeric; mode text;
begin
  lvl := case p_type when 'products' then 'operator' when 'suppliers' then 'manager' when 'categories' then 'manager' when 'opening' then 'manager' when 'reorder' then 'manager' else null end;
  if lvl is null then raise exception 'tipo de importação inválido' using errcode = '22023'; end if;
  perform private.inv_guard(p_org, lvl);
  mgr := private.inv_is_manager(p_org);
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then raise exception 'arquivo inválido' using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then raise exception 'o arquivo deve ter de 1 a 5.000 linhas de dados' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inv_import:' || p_org::text || p_type || p_file_hash, 0));
  select * into ex from public.import_jobs where organization_id = p_org and import_type = p_type and file_hash = p_file_hash and status = 'completed';
  if found then return jsonb_build_object('duplicate_file', true, 'import_id', ex.id, 'status', ex.status); end if;
  insert into public.import_jobs (organization_id, import_type, file_name, file_hash, created_by) values (p_org, p_type, left(coalesce(nullif(trim(p_file_name), ''), 'arquivo.csv'), 200), p_file_hash, (select auth.uid())) returning id into job;
  for r in select e from jsonb_array_elements(p_rows) e loop
    n := n + 1; st := 'valid'; msg := null; nk := null;
    begin
      if jsonb_typeof(r) <> 'object' then raise exception 'linha em formato inválido'; end if;
      if nullif(r ->> '_parse_error', '') is not null then raise exception '%', left(r ->> '_parse_error', 250); end if;
      if p_type = 'products' then
        v_sku := nullif(trim(r ->> 'sku'), '');
        if v_sku is null then raise exception 'SKU obrigatório'; end if;
        if v_sku !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$' then raise exception 'SKU inválido (letras, números e . _ / -, até 40 caracteres)'; end if;
        if nullif(trim(r ->> 'name'), '') is null or char_length(trim(r ->> 'name')) > 160 then raise exception 'nome obrigatório (até 160 caracteres)'; end if;
        nk := lower(v_sku);
        select * into u from public.units_of_measure x where x.organization_id = p_org and lower(x.symbol) = lower(trim(coalesce(r ->> 'unit', ''))) and x.active;
        if not found then raise exception 'unidade «%» não cadastrada', left(coalesce(r ->> 'unit', ''), 10); end if;
        if nullif(trim(r ->> 'category'), '') is not null then
          select count(*) into cat_n from public.product_categories c where c.organization_id = p_org and lower(c.name) = lower(trim(r ->> 'category')) and c.active;
          if cat_n = 0 then raise exception 'categoria «%» não cadastrada (importe as categorias antes)', left(r ->> 'category', 40); end if;
          if cat_n > 1 then raise exception 'categoria «%» ambígua (existe em mais de um nível)', left(r ->> 'category', 40); end if;
        end if;
        if nullif(trim(r ->> 'type'), '') is not null and (r ->> 'type') not in ('merchandise', 'raw_material', 'supply', 'consumable', 'other') then raise exception 'tipo de produto inválido'; end if;
        if nullif(trim(r ->> 'barcode'), '') is not null then
          if trim(r ->> 'barcode') !~ '^[A-Za-z0-9._-]{3,48}$' or private.inv_gtin_ok(trim(r ->> 'barcode')) is false then raise exception 'código de barras inválido'; end if;
          if exists (select 1 from public.products p where p.organization_id = p_org and lower(p.barcode) = lower(trim(r ->> 'barcode')) and lower(p.sku) <> lower(v_sku)) then raise exception 'código de barras já usado por outro produto'; end if;
          if ('bc:' || lower(trim(r ->> 'barcode'))) = any (seen) and not (nk = any (seen)) then raise exception 'código de barras repetido no arquivo'; end if;
        end if;
        mn := private.inv_num(r, 'minimum', 'mínimo'); rp := private.inv_num(r, 'reorder_point', 'ponto de reposição'); tg := private.inv_num(r, 'target', 'estoque-alvo');
        if (mn is not null or rp is not null or tg is not null) and not mgr then raise exception 'operador não define parâmetros de reposição'; end if;
        if (mn is not null and rp is not null and mn > rp) or (rp is not null and tg is not null and rp > tg) or (mn is not null and tg is not null and mn > tg) then raise exception 'mínimo ≤ ponto de reposição ≤ estoque-alvo'; end if;
        if nullif(trim(r ->> 'supplier'), '') is not null then
          if not mgr then raise exception 'operador não define fornecedor principal'; end if;
          if not exists (select 1 from public.suppliers s where s.organization_id = p_org and lower(s.name) = lower(trim(r ->> 'supplier')) and s.active) then raise exception 'fornecedor «%» não cadastrado', left(r ->> 'supplier', 40); end if;
        end if;
        if nk = any (seen) then st := 'duplicate'; msg := 'SKU repetido no arquivo';
        elsif exists (select 1 from public.products p where p.organization_id = p_org and lower(p.sku) = nk) then st := 'duplicate'; msg := 'SKU já cadastrado (não é atualizado pela importação)';
        else seen := seen || nk; if nullif(trim(r ->> 'barcode'), '') is not null then seen := seen || ('bc:' || lower(trim(r ->> 'barcode'))); end if; end if;
      elsif p_type = 'suppliers' then
        if nullif(trim(r ->> 'name'), '') is null or char_length(trim(r ->> 'name')) > 120 then raise exception 'nome obrigatório (até 120 caracteres)'; end if;
        nk := lower(trim(r ->> 'name'));
        if nullif(trim(r ->> 'email'), '') is not null and trim(r ->> 'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
        perform private.inv_num(r, 'lead_time_days', 'prazo de entrega', 0, 365);
        if nk = any (seen) then st := 'duplicate'; msg := 'fornecedor repetido no arquivo';
        elsif exists (select 1 from public.suppliers s where s.organization_id = p_org and lower(s.name) = nk) then st := 'duplicate'; msg := 'fornecedor já cadastrado';
        else seen := seen || nk; end if;
      elsif p_type = 'categories' then
        if nullif(trim(r ->> 'name'), '') is null or char_length(trim(r ->> 'name')) > 80 then raise exception 'nome obrigatório (até 80 caracteres)'; end if;
        nk := lower(coalesce(trim(r ->> 'parent'), '')) || '>' || lower(trim(r ->> 'name'));
        if nullif(trim(r ->> 'parent'), '') is not null and not (exists (select 1 from public.product_categories c where c.organization_id = p_org and lower(c.name) = lower(trim(r ->> 'parent')))
           or ('cat:' || lower(trim(r ->> 'parent'))) = any (seen)) then raise exception 'categoria-pai «%» não existe (coloque-a antes no arquivo)', left(r ->> 'parent', 40); end if;
        if nk = any (seen) then st := 'duplicate'; msg := 'categoria repetida no arquivo';
        elsif exists (select 1 from public.product_categories c left join public.product_categories pc on pc.id = c.parent_id
                      where c.organization_id = p_org and lower(c.name) = lower(trim(r ->> 'name')) and lower(coalesce(pc.name, '')) = lower(coalesce(trim(r ->> 'parent'), ''))) then st := 'duplicate'; msg := 'categoria já cadastrada';
        else seen := seen || nk || ('cat:' || lower(trim(r ->> 'name'))); end if;
      elsif p_type = 'opening' then
        v_sku := nullif(trim(r ->> 'sku'), '');
        if v_sku is null then raise exception 'SKU obrigatório'; end if;
        select w.id into wid from public.warehouses w where w.organization_id = p_org and lower(w.code) = lower(trim(coalesce(r ->> 'warehouse', ''))) and w.active;
        if wid is null then raise exception 'depósito «%» não cadastrado ou arquivado', left(coalesce(r ->> 'warehouse', ''), 20); end if;
        select p.id into pid from public.products p where p.organization_id = p_org and lower(p.sku) = lower(v_sku) and p.archived_at is null and p.status = 'active';
        if pid is null then raise exception 'produto «%» não encontrado ou inativo', left(v_sku, 40); end if;
        q := private.inv_num(r, 'quantity', 'quantidade', 0.001, 999999999999.999);
        if q is null then raise exception 'quantidade obrigatória'; end if;
        perform private.inv_check_product(p_org, pid, q);
        mode := coalesce(nullif(trim(r ->> 'cost_mode'), ''), 'informed');
        if mode not in ('informed', 'none') then raise exception 'política de custo inválida (informado ou sem custo)'; end if;
        cost := private.inv_num(r, 'unit_cost', 'custo unitário', 0, 99999999999999);
        if mode = 'informed' and cost is null then raise exception 'custo unitário obrigatório no saldo inicial'; end if;
        if cost is not null and cost <> round(cost, 4) then raise exception 'custo unitário aceita no máximo 4 casas decimais (centavos)'; end if;
        nk := lower(v_sku) || '@' || lower(trim(r ->> 'warehouse'));
        if nk = any (seen) then st := 'duplicate'; msg := 'produto repetido neste depósito no arquivo';
        elsif exists (select 1 from public.stock_movements m join public.stock_operations o on o.id = m.operation_id
                      where m.organization_id = p_org and m.product_id = pid and m.warehouse_id = wid and m.movement_type = 'opening' and o.status = 'confirmed') then st := 'duplicate'; msg := 'saldo inicial já lançado para este produto neste depósito';
        else seen := seen || nk; end if;
      else -- reorder
        v_sku := nullif(trim(r ->> 'sku'), '');
        if v_sku is null then raise exception 'SKU obrigatório'; end if;
        select p.id into pid from public.products p where p.organization_id = p_org and lower(p.sku) = lower(v_sku) and p.archived_at is null;
        if pid is null then raise exception 'produto «%» não encontrado ou arquivado', left(v_sku, 40); end if;
        if nullif(trim(r ->> 'warehouse'), '') is not null and not exists (select 1 from public.warehouses w where w.organization_id = p_org and lower(w.code) = lower(trim(r ->> 'warehouse'))) then raise exception 'depósito «%» não cadastrado', left(r ->> 'warehouse', 20); end if;
        mn := private.inv_num(r, 'minimum', 'mínimo'); rp := private.inv_num(r, 'reorder_point', 'ponto de reposição'); tg := private.inv_num(r, 'target', 'estoque-alvo');
        if mn is null or rp is null then raise exception 'mínimo e ponto de reposição são obrigatórios'; end if;
        if mn > rp or (tg is not null and rp > tg) then raise exception 'mínimo ≤ ponto de reposição ≤ estoque-alvo'; end if;
        perform private.inv_num(r, 'lead_time_days', 'prazo de entrega', 0, 365);
        nk := lower(v_sku) || '@' || lower(coalesce(trim(r ->> 'warehouse'), ''));
        if nk = any (seen) then st := 'duplicate'; msg := 'regra repetida no arquivo'; else seen := seen || nk; end if;
      end if;
    exception when others then
      st := 'error'; msg := left(sqlerrm, 300);
    end;
    if st = 'valid' then nv := nv + 1; elsif st = 'duplicate' then nd := nd + 1; else ne := ne + 1; end if;
    insert into public.import_rows (organization_id, job_id, row_number, status, parsed_data, error_message, natural_key) values (p_org, job, n, st, r, msg, nk);
  end loop;
  update public.import_jobs set total_rows = n, valid_rows = nv, duplicate_rows = nd, error_rows = ne where id = job;
  if nv = 0 and ne > 0 then
    perform private.inv_notify(p_org, 'import_failed', 'Importação sem linhas válidas', left(coalesce(p_file_name, 'arquivo'), 120) || ': ' || ne || ' linha(s) com erro', '/importacoes/' || job::text, 'imp:' || job::text, array['owner', 'admin', 'manager']::public.org_role[]);
  end if;
  return jsonb_build_object('duplicate_file', false, 'import_id', job, 'status', 'previewed', 'total', n, 'valid', nv, 'duplicates', nd, 'errors', ne);
end $$;

create function public.inv_cancel_import(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.import_jobs%rowtype;
begin
  select * into j from public.import_jobs where id = p_job for update;
  if not found then raise exception 'importação não encontrada' using errcode = '22023'; end if;
  perform private.inv_guard(j.organization_id, 'operator');
  if j.status <> 'previewed' then raise exception 'só importação em prévia pode ser cancelada' using errcode = '55000'; end if;
  update public.import_jobs set status = 'cancelled' where id = p_job;
end $$;

create function public.inv_commit_import(p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.import_jobs%rowtype; org uuid; r record; acc integer := 0; cid uuid; pid uuid; sid uuid; uid_ uuid; wid uuid; items jsonb; wh record; lvl text; d jsonb;
begin
  select * into j from public.import_jobs where id = p_job for update;
  if not found then raise exception 'importação não encontrada' using errcode = '22023'; end if;
  org := j.organization_id;
  lvl := case j.import_type when 'products' then 'operator' else 'manager' end;
  perform private.inv_guard(org, lvl);
  if j.status = 'completed' then return jsonb_build_object('already', true, 'accepted', j.accepted_rows); end if;
  if j.status <> 'previewed' then raise exception 'importação cancelada' using errcode = '55000'; end if;
  if j.valid_rows = 0 then raise exception 'não há linhas válidas para importar' using errcode = '55000'; end if;
  for r in select * from public.import_rows where job_id = p_job and status = 'valid' order by row_number loop
    d := r.parsed_data;
    if j.import_type = 'products' then
      select x.id into uid_ from public.units_of_measure x where x.organization_id = org and lower(x.symbol) = lower(trim(d ->> 'unit')) and x.active;
      select c.id into cid from public.product_categories c where c.organization_id = org and lower(c.name) = lower(trim(coalesce(d ->> 'category', ''))) and c.active limit 1;
      select s.id into sid from public.suppliers s where s.organization_id = org and lower(s.name) = lower(trim(coalesce(d ->> 'supplier', ''))) and s.active limit 1;
      insert into public.products (organization_id, category_id, unit_id, sku, barcode, name, description, product_type, minimum_stock, reorder_point, target_stock, default_supplier_id)
      values (org, cid, uid_, trim(d ->> 'sku'), nullif(trim(d ->> 'barcode'), ''), trim(d ->> 'name'), nullif(left(trim(d ->> 'description'), 1000), ''),
              coalesce(nullif(trim(d ->> 'type'), ''), 'merchandise')::public.inv_product_type, nullif(trim(d ->> 'minimum'), '')::numeric, nullif(trim(d ->> 'reorder_point'), '')::numeric,
              nullif(trim(d ->> 'target'), '')::numeric, sid);
    elsif j.import_type = 'suppliers' then
      insert into public.suppliers (organization_id, name, legal_name, document_number, email, phone, lead_time_days, notes)
      values (org, trim(d ->> 'name'), nullif(left(trim(d ->> 'legal_name'), 160), ''), nullif(left(trim(d ->> 'document'), 20), ''), nullif(trim(d ->> 'email'), ''), nullif(left(trim(d ->> 'phone'), 30), ''),
              nullif(trim(d ->> 'lead_time_days'), '')::integer, nullif(left(trim(d ->> 'notes'), 500), ''));
    elsif j.import_type = 'categories' then
      select c.id into cid from public.product_categories c where c.organization_id = org and lower(c.name) = lower(trim(coalesce(d ->> 'parent', ''))) limit 1;
      insert into public.product_categories (organization_id, parent_id, name, description) values (org, cid, trim(d ->> 'name'), nullif(left(trim(d ->> 'description'), 300), ''));
    elsif j.import_type = 'reorder' then
      select p.id into pid from public.products p where p.organization_id = org and lower(p.sku) = lower(trim(d ->> 'sku'));
      if nullif(trim(d ->> 'warehouse'), '') is null then
        update public.products set minimum_stock = (d ->> 'minimum')::numeric, reorder_point = (d ->> 'reorder_point')::numeric, target_stock = nullif(trim(d ->> 'target'), '')::numeric where id = pid;
      else
        select w.id into wid from public.warehouses w where w.organization_id = org and lower(w.code) = lower(trim(d ->> 'warehouse'));
        insert into public.reorder_rules (organization_id, product_id, warehouse_id, minimum_quantity, reorder_point, target_quantity, lead_time_days)
        values (org, pid, wid, (d ->> 'minimum')::numeric, (d ->> 'reorder_point')::numeric, nullif(trim(d ->> 'target'), '')::numeric, nullif(trim(d ->> 'lead_time_days'), '')::integer)
        on conflict (organization_id, product_id, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid))
        do update set minimum_quantity = excluded.minimum_quantity, reorder_point = excluded.reorder_point, target_quantity = excluded.target_quantity, lead_time_days = excluded.lead_time_days, enabled = true;
      end if;
    end if;
    acc := acc + 1;
  end loop;
  if j.import_type = 'opening' then
    for wh in select distinct lower(trim(x.parsed_data ->> 'warehouse')) as code from public.import_rows x where x.job_id = p_job and x.status = 'valid' order by 1 loop
      select w.id into wid from public.warehouses w where w.organization_id = org and lower(w.code) = wh.code;
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('product_id', p.id, 'quantity', (x.parsed_data ->> 'quantity')::numeric,
               'unit_cost', nullif(trim(x.parsed_data ->> 'unit_cost'), '')::numeric, 'cost_mode', coalesce(nullif(trim(x.parsed_data ->> 'cost_mode'), ''), 'informed'))) order by x.row_number) into items
        from public.import_rows x join public.products p on p.organization_id = org and lower(p.sku) = lower(trim(x.parsed_data ->> 'sku'))
        where x.job_id = p_job and x.status = 'valid' and lower(trim(x.parsed_data ->> 'warehouse')) = wh.code;
      perform public.inv_post_opening(org, wid, items, null, 'imp:' || p_job::text || ':' || wh.code);
    end loop;
  end if;
  update public.import_rows set status = 'imported' where job_id = p_job and status = 'valid';
  update public.import_jobs set status = 'completed', completed_at = now(), accepted_rows = acc where id = p_job;
  return jsonb_build_object('already', false, 'accepted', acc, 'rejected', j.total_rows - acc);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.inv_create_import(uuid, text, text, text, jsonb)', 'public.inv_cancel_import(uuid)', 'public.inv_commit_import(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
