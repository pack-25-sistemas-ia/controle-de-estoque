-- Controle de Estoque Inteligente — MOTOR (parte 3): entrada, saída, transferência, ajuste, saldo inicial e estorno.
-- Toda função: guarda (sessão + MFA + papel + depósito) → idempotência → validações → travas em ordem única → lançamentos → saldo e custo.
-- Ordem das travas: saldos por (depósito, produto), depois estados de custo por produto, por último o contador de operações.
-- Documentação: docs/INVENTORY_LEDGER.md e docs/COSTING_RULES.md.

begin;
set local check_function_bodies = off;

-- ======================================================================= itens (validação e leitura do JSON)
create function private.inv_parse_items(p_items jsonb) returns table (line_no integer, product_id uuid, quantity numeric, unit_cost numeric, cost_mode text, ref_movement uuid, note text)
language plpgsql immutable set search_path = '' as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'informe de 1 a 200 itens' using errcode = '22023';
  end if;
  return query
    select o.ord::integer, (e ->> 'product_id')::uuid, (e ->> 'quantity')::numeric, nullif(e ->> 'unit_cost', '')::numeric,
           nullif(e ->> 'cost_mode', ''), nullif(e ->> 'reference_movement_id', '')::uuid, nullif(left(e ->> 'note', 300), '')
    from jsonb_array_elements(p_items) with ordinality as o(e, ord);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'itens inválidos: produto, quantidade ou custo em formato incorreto' using errcode = '22023';
end $$;

-- Produto apto a movimentar + escala da unidade. Devolve a quantidade validada.
create function private.inv_check_product(p_org uuid, p_product uuid, p_qty numeric) returns text
language plpgsql stable set search_path = '' as $$
declare p public.products%rowtype; u public.units_of_measure%rowtype;
begin
  select * into p from public.products where id = p_product and organization_id = p_org;
  if not found then raise exception 'produto não encontrado nesta empresa' using errcode = '22023'; end if;
  if p.archived_at is not null or p.status <> 'active' then raise exception 'produto «%» está inativo ou arquivado e não recebe movimentação', p.sku using errcode = '55000'; end if;
  select * into u from public.units_of_measure where id = p.unit_id;
  if p_qty is null or p_qty <= 0 then raise exception 'quantidade de «%» deve ser maior que zero', p.sku using errcode = '22023'; end if;
  if p_qty >= 1000000000000 then raise exception 'quantidade de «%» acima do limite', p.sku using errcode = '22023'; end if;
  if p_qty <> round(p_qty, u.decimal_places) then
    raise exception 'quantidade de «%» aceita no máximo % casa(s) decimal(is) (unidade %)', p.sku, u.decimal_places, u.symbol using errcode = '22023';
  end if;
  return p.sku;
end $$;

-- Valor (centavos) de uma saída pelo custo médio vigente: tudo se a saída zera o estoque valorizado; senão proporcional, meio-para-o-par.
create function private.inv_issue_value(p_qty_valued numeric, p_total_value bigint, p_qty numeric) returns bigint
language plpgsql immutable set search_path = '' as $$
begin
  if p_qty >= p_qty_valued then return p_total_value; end if;
  return private.inv_round_div(p_total_value::numeric * (p_qty * 1000), p_qty_valued * 1000);
end $$;

-- Valor de uma entrada ao custo unitário informado (centavos, até 4 casas): meio-para-o-par.
create function private.inv_entry_value(p_qty numeric, p_unit_cost numeric) returns bigint
language plpgsql immutable set search_path = '' as $$
declare v bigint;
begin
  if p_unit_cost <> round(p_unit_cost, 4) then raise exception 'custo unitário aceita no máximo 4 casas decimais (em centavos)' using errcode = '22023'; end if;
  v := private.inv_round_div((p_qty * 1000) * (p_unit_cost * 10000), 10000000);
  if v > 99999999999999 then raise exception 'valor da linha acima do limite' using errcode = '22023'; end if;
  return v;
end $$;

-- ======================================================================= travas e escrita única
create function private.inv_lock(p_org uuid, p_wh uuid[], p_prod uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inventory_balances (organization_id, product_id, warehouse_id)
    select p_org, u.p, u.w from unnest(p_wh, p_prod) as u(w, p) order by u.w, u.p on conflict do nothing;
  insert into public.inventory_cost_state (organization_id, product_id)
    select distinct p_org, x from unnest(p_prod) x order by x on conflict do nothing;
  perform 1 from public.inventory_balances b
    where b.organization_id = p_org and (b.warehouse_id, b.product_id) in (select u.w, u.p from unnest(p_wh, p_prod) as u(w, p))
    order by b.warehouse_id, b.product_id for update;
  perform 1 from public.inventory_cost_state c where c.organization_id = p_org and c.product_id = any (p_prod) order by c.product_id for update;
end $$;
revoke all on function private.inv_lock(uuid, uuid[], uuid[]) from public, anon, authenticated;

create function private.inv_open_op(p_org uuid, p_type public.inv_op_type, p_reason text, p_wh uuid, p_src uuid, p_dst uuid, p_supplier uuid, p_ext text, p_notes text,
  p_key text, p_hash text, p_at timestamptz, p_reversal_of uuid, p_reversal_reason text, p_count uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare num bigint; id uuid;
begin
  num := nextval('public.inv_op_seq');
  insert into public.stock_operations (organization_id, op_number, operation_type, reason_code, warehouse_id, source_warehouse_id, destination_warehouse_id, supplier_id,
    external_reference, notes, idempotency_key, request_hash, count_id, reversal_of_operation_id, reversal_reason, created_by, occurred_at)
  values (p_org, num, p_type, p_reason, p_wh, p_src, p_dst, p_supplier, nullif(trim(p_ext), ''), nullif(trim(p_notes), ''), p_key, p_hash, p_count, p_reversal_of, p_reversal_reason,
    (select auth.uid()), p_at)
  returning stock_operations.id into id;
  return id;
end $$;
revoke all on function private.inv_open_op(uuid, public.inv_op_type, text, uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, uuid, text, uuid) from public, anon, authenticated;

create function private.inv_add_item(p_org uuid, p_op uuid, p_line integer, p_product uuid, p_qty numeric, p_unit_cost numeric, p_policy text, p_ref uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  insert into public.stock_operation_items (organization_id, operation_id, line_no, product_id, quantity, unit_cost_cents, cost_policy, reference_movement_id, note)
  values (p_org, p_op, p_line, p_product, p_qty, p_unit_cost, p_policy, p_ref, p_note) returning stock_operation_items.id into id;
  return id;
end $$;
revoke all on function private.inv_add_item(uuid, uuid, integer, uuid, numeric, numeric, text, uuid, text) from public, anon, authenticated;

-- ÚNICO ponto de escrita no livro. Pré-condição: saldo e estado de custo já travados pelo chamador (inv_lock).
-- p_qty_delta e p_value_delta têm sinal (entrada +, saída −). p_cost_update=false em transferências (valor consolidado não muda).
create function private.inv_post_move(p_org uuid, p_op uuid, p_item uuid, p_product uuid, p_wh uuid, p_mtype public.inv_move_type, p_reason_code text,
  p_qty_delta numeric, p_value_delta bigint, p_unit_cost numeric, p_policy text, p_reverses uuid, p_note text, p_at timestamptz, p_cost_update boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare newbal numeric; mid uuid; cs public.inventory_cost_state%rowtype; qn numeric; vn bigint;
begin
  update public.inventory_balances set quantity_on_hand = quantity_on_hand + p_qty_delta, version = version + 1, updated_at = now()
   where organization_id = p_org and product_id = p_product and warehouse_id = p_wh returning quantity_on_hand into newbal;
  if newbal is null then raise exception 'saldo não travado antes do lançamento' using errcode = 'XX000'; end if;
  insert into public.stock_movements (organization_id, operation_id, item_id, product_id, warehouse_id, movement_type, reason_code, quantity_delta, value_delta_cents,
    unit_cost_cents, cost_policy, balance_after, reverses_movement_id, reason, performed_by, occurred_at)
  values (p_org, p_op, p_item, p_product, p_wh, p_mtype, p_reason_code, p_qty_delta, p_value_delta, p_unit_cost, p_policy, newbal, p_reverses, p_note, (select auth.uid()), p_at)
  returning id into mid;
  if p_cost_update then
    select * into cs from public.inventory_cost_state where organization_id = p_org and product_id = p_product;
    qn := cs.quantity_valued + p_qty_delta; vn := cs.total_value_cents + p_value_delta;
    if qn < 0 or vn < 0 or (qn = 0 and vn <> 0) then
      raise exception 'custo inconsistente neste lançamento (valor restante % para % unidades): estorne antes as saídas posteriores ou use um ajuste', private.inv_brl(vn), private.inv_qty(qn) using errcode = '55000';
    end if;
    update public.inventory_cost_state set quantity_valued = qn, total_value_cents = vn, version = version + 1, updated_at = now() where organization_id = p_org and product_id = p_product;
    insert into public.inventory_cost_events (organization_id, product_id, movement_id, quantity_delta, value_delta_cents, quantity_before, quantity_after, value_before_cents, value_after_cents,
      average_cost_before, average_cost_after)
    values (p_org, p_product, mid, p_qty_delta, p_value_delta, cs.quantity_valued, qn, cs.total_value_cents, vn,
      case when cs.quantity_valued > 0 then round(cs.total_value_cents::numeric / cs.quantity_valued, 4) end, case when qn > 0 then round(vn::numeric / qn, 4) end);
  end if;
  return mid;
end $$;
revoke all on function private.inv_post_move(uuid, uuid, uuid, uuid, uuid, public.inv_move_type, text, numeric, bigint, numeric, text, uuid, text, timestamptz, boolean) from public, anon, authenticated;

-- Hash do pedido (idempotência): mesmo conteúdo + mesma chave = mesma operação; conteúdo diferente com a mesma chave é recusado.
create function private.inv_hash(variadic p_parts text[]) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(array_to_string(p_parts, '|'), 'utf8')), 'hex'); $$;

-- Valida e normaliza a data/hora do evento.
create function private.inv_when(p_at timestamptz) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if p_at is null then return now(); end if;
  if p_at > now() + interval '5 minutes' then raise exception 'a data da movimentação não pode estar no futuro' using errcode = '22023'; end if;
  if p_at < now() - interval '10 years' then raise exception 'data da movimentação muito antiga' using errcode = '22023'; end if;
  return p_at;
end $$;

create function private.inv_check_warehouse(p_org uuid, p_wh uuid) returns void
language plpgsql stable set search_path = '' as $$
declare w public.warehouses%rowtype;
begin
  select * into w from public.warehouses where id = p_wh and organization_id = p_org;
  if not found then raise exception 'depósito não encontrado nesta empresa' using errcode = '22023'; end if;
  if not w.active then raise exception 'depósito «%» está arquivado e não recebe operações', w.name using errcode = '55000'; end if;
end $$;

-- Resolve operação já processada pela chave: devolve o id (mesmo conteúdo) ou recusa (conteúdo diferente).
create function private.inv_idem(p_org uuid, p_key text, p_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ex public.stock_operations%rowtype;
begin
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 100 then raise exception 'chave de idempotência obrigatória (8 a 100 caracteres)' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inv_op:' || p_org::text || ':' || p_key, 0));
  select * into ex from public.stock_operations where organization_id = p_org and idempotency_key = p_key;
  if found then
    if ex.request_hash = p_hash then return ex.id; end if;
    raise exception 'esta chave de operação já foi usada com outro conteúdo' using errcode = '23505';
  end if;
  return null;
end $$;
revoke all on function private.inv_idem(uuid, text, text) from public, anon, authenticated;

-- ======================================================================= ENTRADA
-- p_items: [{product_id, quantity, unit_cost (centavos, até 4 casas), cost_mode: informed|average|original|none, reference_movement_id}]
create function public.inv_post_entry(p_org uuid, p_warehouse uuid, p_reason text, p_items jsonb, p_supplier uuid, p_external_ref text, p_notes text, p_at timestamptz, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ln integer[]; pr uuid[]; qt numeric[]; uc numeric[]; md text[]; rf uuid[]; nt text[]; n integer; i integer; h text; op uuid; ex uuid; at_ timestamptz;
  cs public.inventory_cost_state%rowtype; mode text; val bigint; pol text; unitc numeric; it uuid; sku text; refm public.stock_movements%rowtype; whs uuid[];
begin
  perform private.inv_guard(p_org, 'operator', p_warehouse);
  if p_reason not in ('purchase', 'customer_return', 'other_entry') then raise exception 'motivo de entrada inválido' using errcode = '22023'; end if;
  select array_agg(x.line_no order by x.line_no), array_agg(x.product_id order by x.line_no), array_agg(x.quantity order by x.line_no), array_agg(x.unit_cost order by x.line_no),
         array_agg(x.cost_mode order by x.line_no), array_agg(x.ref_movement order by x.line_no), array_agg(x.note order by x.line_no)
    into ln, pr, qt, uc, md, rf, nt from private.inv_parse_items(p_items) x;
  n := cardinality(pr);
  if exists (select 1 from unnest(pr) z where z is null) then raise exception 'item sem produto' using errcode = '22023'; end if;
  if (select count(distinct z) from unnest(pr) z) <> n then raise exception 'o mesmo produto aparece mais de uma vez na operação' using errcode = '22023'; end if;
  h := private.inv_hash('entry', p_org::text, p_warehouse::text, p_reason, coalesce(p_supplier::text, ''), coalesce(p_external_ref, ''), p_items::text);
  ex := private.inv_idem(p_org, p_key, h);
  if ex is not null then return ex; end if;
  at_ := private.inv_when(p_at);
  perform private.inv_check_warehouse(p_org, p_warehouse);
  if p_supplier is not null and not exists (select 1 from public.suppliers s where s.id = p_supplier and s.organization_id = p_org and s.active) then
    raise exception 'fornecedor não encontrado ou inativo' using errcode = '22023';
  end if;
  for i in 1 .. n loop perform private.inv_check_product(p_org, pr[i], qt[i]); end loop;
  select array_agg(p_warehouse) into whs from unnest(pr);
  perform private.inv_lock(p_org, whs, pr);
  op := private.inv_open_op(p_org, 'entry', p_reason, p_warehouse, null, null, p_supplier, p_external_ref, p_notes, p_key, h, at_, null, null, null);
  for i in 1 .. n loop
    sku := (select p.sku from public.products p where p.id = pr[i]);
    mode := coalesce(md[i], case p_reason when 'purchase' then 'informed' else 'average' end);
    if mode not in ('informed', 'average', 'original', 'none') then raise exception 'política de custo inválida em «%»', sku using errcode = '22023'; end if;
    if p_reason = 'purchase' and mode not in ('informed', 'none') then raise exception 'compra exige custo informado (ou «sem custo» para bonificação) em «%»', sku using errcode = '22023'; end if;
    if p_reason = 'other_entry' and mode = 'original' then raise exception 'custo original só vale para devolução de cliente («%»)', sku using errcode = '22023'; end if;
    select * into cs from public.inventory_cost_state where organization_id = p_org and product_id = pr[i];
    unitc := null;
    if mode = 'informed' then
      if uc[i] is null or uc[i] < 0 or uc[i] >= 100000000000000 then raise exception 'informe o custo unitário de «%»', sku using errcode = '22023'; end if;
      if p_reason = 'purchase' and uc[i] = 0 then raise exception 'custo zero em compra: marque «sem custo (bonificação)» em «%»', sku using errcode = '22023'; end if;
      val := private.inv_entry_value(qt[i], uc[i]); unitc := uc[i]; pol := 'informed';
    elsif mode = 'none' then
      val := 0; unitc := 0; pol := 'none';
    elsif mode = 'average' then
      if cs.quantity_valued <= 0 then raise exception 'não há custo médio para «%»: informe o custo unitário', sku using errcode = '22023'; end if;
      val := private.inv_round_div(cs.total_value_cents::numeric * (qt[i] * 1000), cs.quantity_valued * 1000); pol := 'average';
      unitc := round(val::numeric / qt[i], 4);
    else
      if rf[i] is null then raise exception 'devolução com custo original exige a saída de origem em «%»', sku using errcode = '22023'; end if;
      select * into refm from public.stock_movements where id = rf[i] and organization_id = p_org;
      if not found or refm.product_id <> pr[i] or refm.movement_type <> 'issue' then raise exception 'a saída de origem não corresponde ao produto «%»', sku using errcode = '22023'; end if;
      if qt[i] > abs(refm.quantity_delta) then raise exception 'devolução de «%» maior que a quantidade da saída original', sku using errcode = '22023'; end if;
      val := private.inv_round_div(abs(refm.value_delta_cents)::numeric * (qt[i] * 1000), abs(refm.quantity_delta) * 1000); pol := 'original';
      unitc := round(val::numeric / qt[i], 4);
    end if;
    if cs.total_value_cents + val > 99999999999999 then raise exception 'valor do estoque de «%» acima do limite', sku using errcode = '22023'; end if;
    it := private.inv_add_item(p_org, op, ln[i], pr[i], qt[i], unitc, pol, rf[i], nt[i]);
    perform private.inv_post_move(p_org, op, it, pr[i], p_warehouse, 'entry', p_reason, qt[i], val, unitc, pol, null, p_notes, at_, true);
  end loop;
  return op;
end $$;

-- ======================================================================= SAÍDA
create function public.inv_post_issue(p_org uuid, p_warehouse uuid, p_reason text, p_items jsonb, p_external_ref text, p_notes text, p_at timestamptz, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ln integer[]; pr uuid[]; qt numeric[]; nt text[]; n integer; i integer; h text; op uuid; ex uuid; at_ timestamptz;
  cs public.inventory_cost_state%rowtype; bal numeric; val bigint; it uuid; sku text; whs uuid[];
begin
  perform private.inv_guard(p_org, 'operator', p_warehouse);
  if p_reason not in ('sale', 'internal_use', 'loss', 'damage', 'supplier_return', 'sample', 'other_issue') then raise exception 'motivo de saída inválido' using errcode = '22023'; end if;
  if p_reason in ('loss', 'damage', 'other_issue') and (p_notes is null or char_length(trim(p_notes)) < 5) then
    raise exception 'informe a observação (mínimo 5 caracteres) para perda, avaria ou outro motivo' using errcode = '22023';
  end if;
  select array_agg(x.line_no order by x.line_no), array_agg(x.product_id order by x.line_no), array_agg(x.quantity order by x.line_no), array_agg(x.note order by x.line_no)
    into ln, pr, qt, nt from private.inv_parse_items(p_items) x;
  n := cardinality(pr);
  if exists (select 1 from unnest(pr) z where z is null) then raise exception 'item sem produto' using errcode = '22023'; end if;
  if (select count(distinct z) from unnest(pr) z) <> n then raise exception 'o mesmo produto aparece mais de uma vez na operação' using errcode = '22023'; end if;
  h := private.inv_hash('issue', p_org::text, p_warehouse::text, p_reason, coalesce(p_external_ref, ''), p_items::text);
  ex := private.inv_idem(p_org, p_key, h);
  if ex is not null then return ex; end if;
  at_ := private.inv_when(p_at);
  perform private.inv_check_warehouse(p_org, p_warehouse);
  for i in 1 .. n loop perform private.inv_check_product(p_org, pr[i], qt[i]); end loop;
  select array_agg(p_warehouse) into whs from unnest(pr);
  perform private.inv_lock(p_org, whs, pr);
  for i in 1 .. n loop
    select b.quantity_on_hand into bal from public.inventory_balances b where b.organization_id = p_org and b.product_id = pr[i] and b.warehouse_id = p_warehouse;
    if bal < qt[i] then
      sku := (select p.sku from public.products p where p.id = pr[i]);
      raise exception 'saldo insuficiente de «%» neste depósito: disponível %, pedido %', sku, private.inv_qty(bal), private.inv_qty(qt[i]) using errcode = '55000';
    end if;
  end loop;
  op := private.inv_open_op(p_org, 'issue', p_reason, p_warehouse, null, null, null, p_external_ref, p_notes, p_key, h, at_, null, null, null);
  for i in 1 .. n loop
    select * into cs from public.inventory_cost_state where organization_id = p_org and product_id = pr[i];
    val := private.inv_issue_value(cs.quantity_valued, cs.total_value_cents, qt[i]);
    it := private.inv_add_item(p_org, op, ln[i], pr[i], qt[i], round(val::numeric / qt[i], 4), 'average', null, nt[i]);
    perform private.inv_post_move(p_org, op, it, pr[i], p_warehouse, 'issue', p_reason, -qt[i], -val, round(val::numeric / qt[i], 4), 'average', null, p_notes, at_, true);
  end loop;
  return op;
end $$;

-- ======================================================================= TRANSFERÊNCIA
create function public.inv_post_transfer(p_org uuid, p_source uuid, p_destination uuid, p_items jsonb, p_notes text, p_at timestamptz, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ln integer[]; pr uuid[]; qt numeric[]; nt text[]; n integer; i integer; h text; op uuid; ex uuid; at_ timestamptz;
  cs public.inventory_cost_state%rowtype; bal numeric; val bigint; it uuid; sku text; whs uuid[]; uc numeric;
begin
  perform private.inv_guard(p_org, 'operator', p_source);
  if p_source is null or p_destination is null or p_source = p_destination then raise exception 'origem e destino devem ser depósitos diferentes' using errcode = '22023'; end if;
  if not private.inv_wh_allowed(p_org, p_destination) then raise exception 'sem permissão no depósito de destino' using errcode = '42501'; end if;
  select array_agg(x.line_no order by x.line_no), array_agg(x.product_id order by x.line_no), array_agg(x.quantity order by x.line_no), array_agg(x.note order by x.line_no)
    into ln, pr, qt, nt from private.inv_parse_items(p_items) x;
  n := cardinality(pr);
  if exists (select 1 from unnest(pr) z where z is null) then raise exception 'item sem produto' using errcode = '22023'; end if;
  if (select count(distinct z) from unnest(pr) z) <> n then raise exception 'o mesmo produto aparece mais de uma vez na operação' using errcode = '22023'; end if;
  h := private.inv_hash('transfer', p_org::text, p_source::text, p_destination::text, p_items::text);
  ex := private.inv_idem(p_org, p_key, h);
  if ex is not null then return ex; end if;
  at_ := private.inv_when(p_at);
  perform private.inv_check_warehouse(p_org, p_source);
  perform private.inv_check_warehouse(p_org, p_destination);
  for i in 1 .. n loop perform private.inv_check_product(p_org, pr[i], qt[i]); end loop;
  select array_cat(array_agg(p_source), array_agg(p_destination)) into whs from unnest(pr);
  perform private.inv_lock(p_org, whs, array_cat(pr, pr));
  for i in 1 .. n loop
    select b.quantity_on_hand into bal from public.inventory_balances b where b.organization_id = p_org and b.product_id = pr[i] and b.warehouse_id = p_source;
    if bal < qt[i] then
      sku := (select p.sku from public.products p where p.id = pr[i]);
      raise exception 'saldo insuficiente de «%» no depósito de origem: disponível %, pedido %', sku, private.inv_qty(bal), private.inv_qty(qt[i]) using errcode = '55000';
    end if;
  end loop;
  op := private.inv_open_op(p_org, 'transfer', null, null, p_source, p_destination, null, null, p_notes, p_key, h, at_, null, null, null);
  for i in 1 .. n loop
    select * into cs from public.inventory_cost_state where organization_id = p_org and product_id = pr[i];
    val := private.inv_issue_value(cs.quantity_valued, cs.total_value_cents, qt[i]);
    uc := round(val::numeric / qt[i], 4);
    it := private.inv_add_item(p_org, op, ln[i], pr[i], qt[i], uc, 'average', null, nt[i]);
    perform private.inv_post_move(p_org, op, it, pr[i], p_source, 'transfer_out', null, -qt[i], -val, uc, 'average', null, p_notes, at_, false);
    perform private.inv_post_move(p_org, op, it, pr[i], p_destination, 'transfer_in', null, qt[i], val, uc, 'average', null, p_notes, at_, false);
  end loop;
  return op;
end $$;

-- ======================================================================= AJUSTE (gestor/administrador, sempre justificado)
create function public.inv_post_adjustment(p_org uuid, p_warehouse uuid, p_direction text, p_reason text, p_justification text, p_items jsonb, p_at timestamptz, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ln integer[]; pr uuid[]; qt numeric[]; uc numeric[]; md text[]; nt text[]; n integer; i integer; h text; op uuid; ex uuid; at_ timestamptz;
  cs public.inventory_cost_state%rowtype; bal numeric; val bigint; it uuid; sku text; whs uuid[]; mode text; pol text; unitc numeric;
begin
  perform private.inv_guard(p_org, 'manager', p_warehouse);
  if p_direction not in ('in', 'out') then raise exception 'direção do ajuste inválida' using errcode = '22023'; end if;
  if p_reason not in ('count_difference', 'damage', 'loss', 'operational_error', 'other_adjustment') then raise exception 'motivo de ajuste inválido' using errcode = '22023'; end if;
  if p_justification is null or char_length(trim(p_justification)) < 5 then raise exception 'informe a justificativa do ajuste (mínimo 5 caracteres)' using errcode = '22023'; end if;
  select array_agg(x.line_no order by x.line_no), array_agg(x.product_id order by x.line_no), array_agg(x.quantity order by x.line_no), array_agg(x.unit_cost order by x.line_no),
         array_agg(x.cost_mode order by x.line_no), array_agg(x.note order by x.line_no)
    into ln, pr, qt, uc, md, nt from private.inv_parse_items(p_items) x;
  n := cardinality(pr);
  if exists (select 1 from unnest(pr) z where z is null) then raise exception 'item sem produto' using errcode = '22023'; end if;
  if (select count(distinct z) from unnest(pr) z) <> n then raise exception 'o mesmo produto aparece mais de uma vez na operação' using errcode = '22023'; end if;
  h := private.inv_hash('adjustment', p_org::text, p_warehouse::text, p_direction, p_reason, p_justification, p_items::text);
  ex := private.inv_idem(p_org, p_key, h);
  if ex is not null then return ex; end if;
  at_ := private.inv_when(p_at);
  perform private.inv_check_warehouse(p_org, p_warehouse);
  for i in 1 .. n loop perform private.inv_check_product(p_org, pr[i], qt[i]); end loop;
  select array_agg(p_warehouse) into whs from unnest(pr);
  perform private.inv_lock(p_org, whs, pr);
  if p_direction = 'out' then
    for i in 1 .. n loop
      select b.quantity_on_hand into bal from public.inventory_balances b where b.organization_id = p_org and b.product_id = pr[i] and b.warehouse_id = p_warehouse;
      if bal < qt[i] then
        sku := (select p.sku from public.products p where p.id = pr[i]);
        raise exception 'ajuste negativo de «%» maior que o saldo: disponível %, pedido %', sku, private.inv_qty(bal), private.inv_qty(qt[i]) using errcode = '55000';
      end if;
    end loop;
  end if;
  op := private.inv_open_op(p_org, 'adjustment', p_reason, p_warehouse, null, null, null, null, p_justification, p_key, h, at_, null, null, null);
  for i in 1 .. n loop
    sku := (select p.sku from public.products p where p.id = pr[i]);
    select * into cs from public.inventory_cost_state where organization_id = p_org and product_id = pr[i];
    if p_direction = 'out' then
      val := private.inv_issue_value(cs.quantity_valued, cs.total_value_cents, qt[i]); pol := 'average'; unitc := round(val::numeric / qt[i], 4);
      it := private.inv_add_item(p_org, op, ln[i], pr[i], qt[i], unitc, pol, null, nt[i]);
      perform private.inv_post_move(p_org, op, it, pr[i], p_warehouse, 'adjustment_out', p_reason, -qt[i], -val, unitc, pol, null, p_justification, at_, true);
    else
      mode := coalesce(md[i], 'average');
      if mode not in ('average', 'informed', 'none') then raise exception 'política de custo inválida em «%»', sku using errcode = '22023'; end if;
      if mode = 'informed' then
        if uc[i] is null or uc[i] < 0 or uc[i] >= 100000000000000 then raise exception 'informe o custo unitário de «%»', sku using errcode = '22023'; end if;
        val := private.inv_entry_value(qt[i], uc[i]); pol := 'informed'; unitc := uc[i];
      elsif mode = 'none' then
        val := 0; pol := 'none'; unitc := 0;
      else
        if cs.quantity_valued <= 0 then raise exception 'não há custo médio para «%»: informe o custo unitário (não se inventa custo)', sku using errcode = '22023'; end if;
        val := private.inv_round_div(cs.total_value_cents::numeric * (qt[i] * 1000), cs.quantity_valued * 1000); pol := 'average'; unitc := round(val::numeric / qt[i], 4);
      end if;
      if cs.total_value_cents + val > 99999999999999 then raise exception 'valor do estoque de «%» acima do limite', sku using errcode = '22023'; end if;
      it := private.inv_add_item(p_org, op, ln[i], pr[i], qt[i], unitc, pol, null, nt[i]);
      perform private.inv_post_move(p_org, op, it, pr[i], p_warehouse, 'adjustment_in', p_reason, qt[i], val, unitc, pol, null, p_justification, at_, true);
    end if;
  end loop;
  return op;
end $$;

-- ======================================================================= SALDO INICIAL (abertura)
create function public.inv_post_opening(p_org uuid, p_warehouse uuid, p_items jsonb, p_at timestamptz, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ln integer[]; pr uuid[]; qt numeric[]; uc numeric[]; md text[]; nt text[]; n integer; i integer; h text; op uuid; ex uuid; at_ timestamptz;
  cs public.inventory_cost_state%rowtype; val bigint; it uuid; sku text; whs uuid[]; pol text; unitc numeric;
begin
  perform private.inv_guard(p_org, 'manager', p_warehouse);
  select array_agg(x.line_no order by x.line_no), array_agg(x.product_id order by x.line_no), array_agg(x.quantity order by x.line_no), array_agg(x.unit_cost order by x.line_no),
         array_agg(x.cost_mode order by x.line_no), array_agg(x.note order by x.line_no)
    into ln, pr, qt, uc, md, nt from private.inv_parse_items(p_items) x;
  n := cardinality(pr);
  if exists (select 1 from unnest(pr) z where z is null) then raise exception 'item sem produto' using errcode = '22023'; end if;
  if (select count(distinct z) from unnest(pr) z) <> n then raise exception 'o mesmo produto aparece mais de uma vez na operação' using errcode = '22023'; end if;
  h := private.inv_hash('opening', p_org::text, p_warehouse::text, p_items::text);
  ex := private.inv_idem(p_org, p_key, h);
  if ex is not null then return ex; end if;
  at_ := private.inv_when(p_at);
  perform private.inv_check_warehouse(p_org, p_warehouse);
  for i in 1 .. n loop perform private.inv_check_product(p_org, pr[i], qt[i]); end loop;
  select array_agg(p_warehouse) into whs from unnest(pr);
  perform private.inv_lock(p_org, whs, pr);
  for i in 1 .. n loop
    if exists (select 1 from public.stock_movements m join public.stock_operations o on o.id = m.operation_id
               where m.organization_id = p_org and m.product_id = pr[i] and m.warehouse_id = p_warehouse and m.movement_type = 'opening' and o.status = 'confirmed') then
      sku := (select p.sku from public.products p where p.id = pr[i]);
      raise exception 'saldo inicial de «%» já lançado neste depósito (use entrada, ajuste ou estorne a abertura)', sku using errcode = '23505';
    end if;
  end loop;
  op := private.inv_open_op(p_org, 'opening', 'opening', p_warehouse, null, null, null, null, 'Saldo inicial', p_key, h, at_, null, null, null);
  for i in 1 .. n loop
    sku := (select p.sku from public.products p where p.id = pr[i]);
    select * into cs from public.inventory_cost_state where organization_id = p_org and product_id = pr[i];
    if coalesce(md[i], 'informed') = 'none' then val := 0; pol := 'none'; unitc := 0;
    elsif coalesce(md[i], 'informed') = 'informed' then
      if uc[i] is null or uc[i] < 0 or uc[i] >= 100000000000000 then raise exception 'informe o custo unitário de «%»', sku using errcode = '22023'; end if;
      val := private.inv_entry_value(qt[i], uc[i]); pol := 'informed'; unitc := uc[i];
    else raise exception 'saldo inicial exige custo informado (ou «sem custo») em «%»', sku using errcode = '22023'; end if;
    if cs.total_value_cents + val > 99999999999999 then raise exception 'valor do estoque de «%» acima do limite', sku using errcode = '22023'; end if;
    it := private.inv_add_item(p_org, op, ln[i], pr[i], qt[i], unitc, pol, null, nt[i]);
    perform private.inv_post_move(p_org, op, it, pr[i], p_warehouse, 'opening', 'opening', qt[i], val, unitc, pol, null, 'Saldo inicial', at_, true);
  end loop;
  return op;
end $$;

-- ======================================================================= ESTORNO (movimentos compensatórios; nunca edita nem apaga)
create function public.inv_reverse_operation(p_operation uuid, p_reason text, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.stock_operations%rowtype; m record; org uuid; h text; ex uuid; op uuid; it uuid; wh uuid[]; pr uuid[]; bal numeric; sku text; cost_upd boolean; mt public.inv_move_type; i integer := 0; items_ uuid[] := '{}';
  src_item public.stock_operation_items%rowtype; lines integer := 0;
begin
  select * into o from public.stock_operations where id = p_operation;
  if not found then raise exception 'operação não encontrada' using errcode = '22023'; end if;
  org := o.organization_id;
  perform private.inv_guard(org, 'manager');
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo do estorno (mínimo 5 caracteres)' using errcode = '22023'; end if;
  h := private.inv_hash('reversal', org::text, p_operation::text);
  ex := private.inv_idem(org, p_key, h);
  if ex is not null then return ex; end if;
  select * into o from public.stock_operations where id = p_operation for update;
  if o.operation_type = 'reversal' then raise exception 'um estorno não pode ser estornado' using errcode = '55000'; end if;
  if o.status = 'reversed' then raise exception 'operação já estornada' using errcode = '55000'; end if;
  select array_agg(m2.warehouse_id), array_agg(m2.product_id) into wh, pr from public.stock_movements m2 where m2.operation_id = p_operation;
  perform private.inv_lock(org, wh, pr);
  -- tudo que será subtraído precisa existir no saldo
  for m in select * from public.stock_movements where operation_id = p_operation order by created_at, id loop
    if m.quantity_delta > 0 then
      select b.quantity_on_hand into bal from public.inventory_balances b where b.organization_id = org and b.product_id = m.product_id and b.warehouse_id = m.warehouse_id;
      if bal < m.quantity_delta then
        sku := (select p.sku from public.products p where p.id = m.product_id);
        raise exception 'não é possível estornar: o saldo atual de «%» (%) é menor que a quantidade a retirar (%)', sku, private.inv_qty(bal), private.inv_qty(m.quantity_delta) using errcode = '55000';
      end if;
    end if;
  end loop;
  op := private.inv_open_op(org, 'reversal', o.reason_code, coalesce(o.warehouse_id, o.source_warehouse_id), null, null, o.supplier_id, o.external_reference, trim(p_reason), p_key, h, now(), p_operation, trim(p_reason), null);
  for m in select * from public.stock_movements where operation_id = p_operation order by created_at, id loop
    select * into src_item from public.stock_operation_items where id = m.item_id;
    it := (select i2.id from public.stock_operation_items i2 where i2.operation_id = op and i2.product_id = m.product_id);
    if it is null then
      lines := lines + 1;
      it := private.inv_add_item(org, op, lines, m.product_id, src_item.quantity, src_item.unit_cost_cents, src_item.cost_policy, null, 'Estorno da operação ' || (select count(*) from public.stock_operations x where x.organization_id = o.organization_id and x.op_number <= o.op_number));
    end if;
    cost_upd := m.movement_type not in ('transfer_out', 'transfer_in');
    perform private.inv_post_move(org, op, it, m.product_id, m.warehouse_id, 'reversal', o.reason_code, -m.quantity_delta, -m.value_delta_cents, m.unit_cost_cents, m.cost_policy, m.id, trim(p_reason), now(), cost_upd);
  end loop;
  update public.stock_operations set status = 'reversed', reversed_at = now(), reversed_by = (select auth.uid()) where id = p_operation;
  return op;
end $$;

-- ======================================================================= RECONCILIAÇÃO (prova de integridade)
-- Devolve as divergências entre livro, saldo materializado e estado de custo. Esperado: nenhuma linha.
create function public.inv_reconcile(p_org uuid) returns table (kind text, product_id uuid, warehouse_id uuid, expected numeric, found numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.inv_guard(p_org, 'read');
  return query
    select 'saldo_x_livro'::text, coalesce(b.product_id, m.product_id), coalesce(b.warehouse_id, m.warehouse_id), coalesce(m.s, 0), coalesce(b.quantity_on_hand, 0)
    from public.inventory_balances b
    full join (select x.product_id, x.warehouse_id, sum(x.quantity_delta) s from public.stock_movements x where x.organization_id = p_org group by 1, 2) m
      on m.product_id = b.product_id and m.warehouse_id = b.warehouse_id
    where (b.organization_id = p_org or b.organization_id is null) and coalesce(m.s, 0) <> coalesce(b.quantity_on_hand, 0)
    union all
    select 'custo_qtd_x_saldos'::text, c.product_id, null::uuid, coalesce(s.q, 0), c.quantity_valued
    from public.inventory_cost_state c
    left join (select y.product_id, sum(y.quantity_on_hand) q from public.inventory_balances y where y.organization_id = p_org group by 1) s on s.product_id = c.product_id
    where c.organization_id = p_org and coalesce(s.q, 0) <> c.quantity_valued
    union all
    select 'custo_valor_x_livro'::text, c.product_id, null::uuid, coalesce(v.s, 0)::numeric, c.total_value_cents::numeric
    from public.inventory_cost_state c
    left join (select z.product_id, sum(z.value_delta_cents) s from public.stock_movements z where z.organization_id = p_org group by 1) v on v.product_id = c.product_id
    where c.organization_id = p_org and coalesce(v.s, 0) <> c.total_value_cents;
end $$;

-- ======================================================================= privilégios das funções públicas
do $$
declare f text;
begin
  foreach f in array array[
    'public.inv_post_entry(uuid, uuid, text, jsonb, uuid, text, text, timestamptz, text)',
    'public.inv_post_issue(uuid, uuid, text, jsonb, text, text, timestamptz, text)',
    'public.inv_post_transfer(uuid, uuid, uuid, jsonb, text, timestamptz, text)',
    'public.inv_post_adjustment(uuid, uuid, text, text, text, jsonb, timestamptz, text)',
    'public.inv_post_opening(uuid, uuid, jsonb, timestamptz, text)',
    'public.inv_reverse_operation(uuid, text, text)',
    'public.inv_reconcile(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
