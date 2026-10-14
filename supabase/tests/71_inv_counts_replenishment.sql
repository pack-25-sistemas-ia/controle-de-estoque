-- Inventário físico (snapshot + versão do saldo), reposição (classificação e sugestões) e avisos.
-- Cálculos à mão:
--  A (un): compra 50 a R$ 10,00 → 50 un, 50000. B (kg): compra 10 kg a 5,00 → 10 un, 5000.
--  Contagem: A contado 47 (−3), B contado 10,5 (+0,5). Depois de uma venda de 1 de A (49 un, 49000) a aprovação é recusada (saldo mudou).
--  Reaberta e recontada: A contado 47 → falta 2 a 49000×2/49 = 2000 → 47 un, 47000; B sobra 0,5 ao custo médio 5000×0,5/10 = 250 → 10,5 un, 5250.
--  Reposição de A: mínimo 10, ponto 20, alvo 100: com 18 → atenção (sugere 82); com 9 → crítico (sugere 91); com 0 → sem estoque (sugere 100).

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.item(p uuid, q numeric, c numeric default null, m text default null, r uuid default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('product_id', p, 'quantity', q, 'unit_cost', c, 'cost_mode', m, 'reference_movement_id', r)) $$;
create function test.bal(p uuid, w uuid) returns numeric language sql as $$ select coalesce((select quantity_on_hand from public.inventory_balances where product_id = p and warehouse_id = w), 0) $$;
create function test.cs(p uuid) returns text language sql as $$ select quantity_valued::text || '/' || total_value_cents::text from public.inventory_cost_state where product_id = p $$;
create function test.cstat(c uuid) returns text language sql as $$ select status::text from public.physical_counts where id = c $$;
create function test.sug(p uuid) returns text language sql as $$ select criterion || ':' || coalesce(trim_scale(suggested_quantity)::text, 'null') || ':' || status from public.replenishment_suggestions where product_id = p order by generated_at desc, status limit 1 $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid; un uuid; kg uuid; w1 uuid; w2 uuid; a uuid; b uuid; c uuid;
begin
  org := public.create_organization('Loja Teste', 'loja-teste');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  select id into un from public.units_of_measure where organization_id = org and symbol = 'un';
  select id into kg from public.units_of_measure where organization_id = org and symbol = 'kg';
  insert into public.warehouses (organization_id, name, code) values (org, 'Loja', 'WH1') returning id into w1;
  insert into public.warehouses (organization_id, name, code) values (org, 'Depósito', 'WH2') returning id into w2;
  insert into public.products (organization_id, unit_id, sku, name) values (org, un, 'A', 'Produto A') returning id into a;
  insert into public.products (organization_id, unit_id, sku, name) values (org, kg, 'B', 'Produto B') returning id into b;
  insert into public.products (organization_id, unit_id, sku, name) values (org, un, 'C', 'Produto C') returning id into c;
  perform set_config('t.w1', w1::text, true); perform set_config('t.w2', w2::text, true);
  perform set_config('t.a', a::text, true); perform set_config('t.b', b::text, true); perform set_config('t.c', c::text, true);
  perform public.inv_post_entry(org, w1, 'purchase', jsonb_build_array(test.item(a, 50, 1000), test.item(b, 10, 500)), null, null, null, null, 'k-seed-0001');
  assert test.cs(a) = '50.000/50000' and test.cs(b) = '10.000/5000', 'estoque inicial por compra';
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('Empresa B', 'empresa-b')::text, true); end $$;
reset role;

-- ===================================================================== 1. inventário: criação, contagem, saldo desatualizado, reabertura e aprovação
:as_na
do $$
declare org uuid := test.t('org'); cid uuid;
begin
  cid := public.inv_create_count(org, test.t('w1'), 'Contagem de outubro', null, 'rotina mensal');
  perform set_config('t.c1', cid::text, true);
  assert test.cstat(cid) = 'counting' and (select count(*) from public.physical_count_items where count_id = cid) = 2, 'contagem criada com os 2 produtos que têm saldo';
  assert (select expected_quantity from public.physical_count_items where count_id = cid and product_id = test.t('a')) = 50, 'esperado capturado: 50';
  assert test.errmsg(format($q$select public.inv_create_count(%L, %L, 'outra', null, null)$q$, org, test.t('w1'))) like '%em andamento%', 'um inventário por depósito';
  assert test.errmsg(format($q$select public.inv_create_count(%L, %L, 'vazio', null, null)$q$, org, test.t('w2'))) like '%nenhum produto para contar%', 'depósito sem saldo exige lista de produtos';
  perform public.inv_count_record((select id from public.physical_count_items where count_id = cid and product_id = test.t('a')), 47, 'faltam 3 na prateleira');
  assert test.errmsg(format($q$select public.inv_count_record(%L, 1.5, null)$q$, (select id from public.physical_count_items where count_id = cid and product_id = test.t('a')))) like '%casa(s) decimal%', 'contagem respeita a escala da unidade';
  perform public.inv_count_record((select id from public.physical_count_items where count_id = cid and product_id = test.t('b')), 10.5, null);
  perform public.inv_submit_count(cid);
  assert test.cstat(cid) = 'awaiting_approval', 'enviado para aprovação';
  assert test.errmsg(format($q$select public.inv_approve_count(%L)$q$, cid)) like '%sem permissão%', 'operador não aprova inventário';
  -- movimentação depois do snapshot: venda de 1 un de A
  perform public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(test.t('a'), 1)), null, null, null, 'k-sale-0001');
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); cid uuid := test.t('c1'); n integer; mv bigint := (select count(*) from public.stock_movements);
begin
  assert test.errmsg(format($q$select public.inv_approve_count(%L)$q$, cid)) like '%saldo alterado%', 'aprovação com saldo desatualizado é recusada';
  assert (select count(*) from public.stock_movements) = mv and test.bal(test.t('a'), test.t('w1')) = 49 and test.cstat(cid) = 'awaiting_approval', 'nenhum ajuste foi aplicado';
  n := public.inv_reopen_stale_count(cid);
  assert n = 1 and test.cstat(cid) = 'counting', 'só o item com saldo alterado volta a contar';
  assert (select expected_quantity from public.physical_count_items where count_id = cid and product_id = test.t('a')) = 49 and (select counted_quantity from public.physical_count_items where count_id = cid and product_id = test.t('a')) is null, 'A: novo esperado 49, contagem zerada';
  assert (select counted_quantity from public.physical_count_items where count_id = cid and product_id = test.t('b')) = 10.5, 'B mantém a contagem (saldo não mudou)';
  perform public.inv_count_record((select id from public.physical_count_items where count_id = cid and product_id = test.t('a')), 47, 'recontagem');
  perform public.inv_submit_count(cid);
  perform public.inv_approve_count(cid);
  assert test.cstat(cid) = 'completed', 'inventário concluído';
  assert test.bal(test.t('a'), test.t('w1')) = 47 and test.cs(test.t('a')) = '47.000/47000', 'A: falta de 2 ao custo médio (2000)';
  assert test.bal(test.t('b'), test.t('w1')) = 10.5 and test.cs(test.t('b')) = '10.500/5250', 'B: sobra de 0,5 ao custo médio (250)';
  assert (select count(*) from public.stock_operations where count_id = cid and operation_type = 'count_adjustment') = 1, 'uma operação de ajuste ligada ao inventário';
  assert (select count(*) from public.stock_movements m join public.stock_operations o on o.id = m.operation_id where o.count_id = cid) = 2, 'dois movimentos (falta e sobra)';
  assert (select cost_policy from public.stock_movements where movement_type = 'count_in') = 'average', 'sobra valorizada pelo custo médio, registrado';
  assert test.errmsg(format($q$select public.inv_approve_count(%L)$q$, cid)) like '%já concluído%', 'não há dupla finalização';
  assert (select count(*) from public.inv_reconcile(org)) = 0, 'reconciliação sem divergências';
  raise notice 'PASS: inventário — snapshot com versão, saldo desatualizado exige recontagem, aprovação gera ajustes ao custo médio';
end $$;
reset role;

-- sobra sem custo médio e cancelamento
:as_na
do $$
declare org uuid := test.t('org'); cid uuid;
begin
  cid := public.inv_create_count(org, test.t('w2'), 'Contagem do depósito', array[test.t('c')], null);
  perform set_config('t.c2', cid::text, true);
  perform public.inv_count_record((select id from public.physical_count_items where count_id = cid), 3, 'achados na reserva');
  perform public.inv_submit_count(cid);
end $$;
reset role;
:as_ma
do $$
declare cid uuid := test.t('c2'); iid uuid;
begin
  assert test.errmsg(format($q$select public.inv_approve_count(%L)$q$, cid)) like '%informe o custo da sobra%', 'sobra sem custo médio exige custo (não se inventa)';
  select id into iid from public.physical_count_items where count_id = cid;
  perform public.inv_count_set_surplus_cost(iid, 700);
  perform public.inv_approve_count(cid);
  assert test.bal(test.t('c'), test.t('w2')) = 3 and test.cs(test.t('c')) = '3.000/2100', 'sobra de 3 a R$ 7,00 = 2100';
  assert (select cost_policy from public.stock_movements where movement_type = 'count_in' and product_id = test.t('c')) = 'informed', 'custo informado registrado';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org'); cid uuid;
begin
  cid := public.inv_create_count(org, test.t('w2'), 'Para cancelar', null, null);
  assert test.errmsg(format($q$select public.inv_cancel_count(%L, 'x')$q$, cid)) like '%motivo%', 'cancelar exige motivo';
  perform public.inv_cancel_count(cid, 'contagem aberta por engano');
  assert test.cstat(cid) = 'cancelled', 'cancelado';
  assert test.errmsg(format($q$select public.inv_count_record(%L, 1, null)$q$, (select id from public.physical_count_items where count_id = cid limit 1))) like '%não está em contagem%', 'cancelado não recebe contagem';
  raise notice 'PASS: sobra com custo informado, cancelamento com motivo';
end $$;
reset role;

-- ===================================================================== 2. reposição
:as_ma
do $$
declare org uuid := test.t('org'); a uuid := test.t('a'); n integer;
begin
  update public.products set minimum_stock = 10, reorder_point = 20, target_stock = 100 where id = a;
  assert public.inv_generate_suggestions(org) = 0, 'com 47 un o produto A está normal: nenhuma sugestão';
  perform public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(a, 27)), null, null, null, 'k-repo-0001');
  assert test.bal(a, test.t('w1')) = 20, 'saldo 20 (exatamente o ponto de reposição)';
  assert public.inv_generate_suggestions(org) = 1 and test.sug(a) = 'attention:80:pending', '20 ≤ 20: atenção no limite, sugere 100 − 20 = 80';
  perform public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(a, 2)), null, null, null, 'k-repo-0001b');
  assert public.inv_generate_suggestions(org) = 0 and test.sug(a) = 'attention:82:pending', '18 ≤ 20: atenção, sugere 82 (a pendente é atualizada)';
  perform public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(a, 8)), null, null, null, 'k-repo-0001c');
  assert public.inv_generate_suggestions(org) = 0 and test.sug(a) = 'critical:90:pending', '10 ≤ 10: crítico no limite do mínimo, sugere 90';
  perform public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(a, 1)), null, null, null, 'k-repo-0002');
  assert public.inv_generate_suggestions(org) = 0 and test.sug(a) = 'critical:91:pending', '9 ≤ 10: crítico, a pendente é atualizada (91), sem duplicar';
  assert (select count(*) from public.replenishment_suggestions where product_id = a) = 1, 'uma pendente por produto e depósito';
  perform public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(a, 9)), null, null, null, 'k-repo-0003');
  perform public.inv_generate_suggestions(org);
  assert test.sug(a) = 'out_of_stock:100:pending', 'zerado: sem estoque, sugere 100';
  -- analisada: não reabre enquanto nada entrar
  perform public.inv_review_suggestion((select id from public.replenishment_suggestions where product_id = a and status = 'pending'), 'reviewed', 120);
  assert test.sug(a) = 'out_of_stock:120:reviewed', 'quantidade ajustada na análise';
  assert public.inv_generate_suggestions(org) = 0, 'analisada e sem entrada nova: não gera outra';
  -- sugestão não vira pedido nem movimento
  assert (select count(*) from public.stock_operations where operation_type = 'entry' and idempotency_key not like 'k-seed%') = 0, 'sugestão não cria operação';
  -- regra por depósito vale sobre o padrão do produto
  insert into public.reorder_rules (organization_id, product_id, warehouse_id, minimum_quantity, reorder_point, target_quantity) values (org, test.t('b'), test.t('w1'), 11, 12, 30);
  assert public.inv_generate_suggestions(org) = 1 and test.sug(test.t('b')) = 'critical:19.5:pending', 'B (10,5 kg ≤ mínimo 11 da regra do depósito): crítico, sugere 30 − 10,5 = 19,5';
  -- entrada recupera o saldo e as pendentes são encerradas
  perform public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('b'), 20, 500)), null, null, null, null, 'k-repo-0004');
  perform public.inv_generate_suggestions(org);
  assert (select status from public.replenishment_suggestions where product_id = test.t('b')) = 'dismissed', 'saldo recuperado (30,5 kg): pendente encerrada automaticamente';
  -- depois de analisada, nova entrada e nova queda reabrem
end $$;
reset role;
update public.replenishment_suggestions set reviewed_at = now() - interval '1 day' where status = 'reviewed' and product_id = (select id from public.products where sku = 'A');
:as_ma
do $$
declare org uuid := test.t('org'); a uuid := test.t('a');
begin
  perform public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(a, 5, 1000)), null, null, null, null, 'k-repo-0005');
  assert public.inv_generate_suggestions(org) = 1 and test.sug(a) = 'critical:95:pending', '5 un ≤ 10 após entrada posterior à análise: nova sugestão (crítico, 95)';
  raise notice 'PASS: reposição — classificação, quantidade sugerida, idempotência, regra por depósito e encerramento automático';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$insert into public.reorder_rules (organization_id, product_id, warehouse_id, minimum_quantity, reorder_point) values (%L, %L, %L, 1, 2)$q$, org, test.t('a'), test.t('w2'))) like '%row-level security%', 'operador não cria regra de reposição';
  assert test.errmsg(format($q$select public.inv_review_suggestion(%L, 'dismissed', null)$q$, (select id from public.replenishment_suggestions limit 1))) like '%sem permissão%', 'operador não trata sugestão';
end $$;
reset role;

-- ===================================================================== 3. avisos
:as_na
do $$
declare org uuid := test.t('org'); r jsonb;
begin
  r := public.inv_run_routines(org);
  assert (r ->> 'notifications')::integer >= 1, 'a rotina gerou avisos de estoque';
  assert (select count(*) from public.inv_notifications) = 0, 'operador não recebe avisos de gestão';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); n1 integer; n2 integer;
begin
  select count(*) into n1 from public.inv_notifications;
  assert n1 >= 3, 'gestor recebe avisos (sem estoque, abaixo do mínimo, reposição, inventário)';
  assert (select count(*) from public.inv_notifications where type = 'count_done') = 2, 'dois inventários concluídos';
  perform public.inv_run_routines(org);
  select count(*) into n2 from public.inv_notifications;
  assert n2 = n1, 'rodar de novo no mesmo dia não duplica avisos';
  assert not exists (select 1 from public.inv_notifications where body ~ '[0-9]{4,}' and type in ('below_minimum', 'out_of_stock')), 'avisos de estoque não carregam valores financeiros';
  perform public.inv_set_notification_pref(org, 'below_minimum', false);
  assert public.inv_mark_notifications_read(org) = n1, 'marcar todas como lidas';
  assert test.errmsg(format($q$select public.inv_set_notification_pref(%L, 'inventado', false)$q$, org)) like '%inválido%', 'tipo de aviso validado';
end $$;
reset role;
:as_va
do $$ begin assert (select count(*) from public.inv_notifications) = 0, 'consulta não vê avisos de outro usuário'; end $$;
reset role;
:as_ob
do $$ begin assert (select count(*) from public.inv_notifications) = 0 and (select count(*) from public.physical_counts) = 0 and (select count(*) from public.replenishment_suggestions) = 0, 'empresa B não enxerga nada de A';
  raise notice 'PASS: avisos por usuário, sem duplicar, sem valores e isolados por empresa'; end $$;
reset role;

-- Estrutura: nenhuma tabela com FK para organization_members E organizations (ambiguidade de embeds do PostgREST).
do $$
declare bad text;
begin
  select string_agg(distinct c1.conrelid::regclass::text, ', ') into bad
  from pg_constraint c1 join pg_constraint c2 on c2.conrelid = c1.conrelid
  where c1.contype = 'f' and c2.contype = 'f' and c1.confrelid = 'public.organization_members'::regclass and c2.confrelid = 'public.organizations'::regclass;
  assert bad is null, 'tabelas com FK para organization_members e organizations (ambíguo para o PostgREST): ' || coalesce(bad, '');
  raise notice 'PASS: sem caminho muitos-para-muitos entre organization_members e organizations';
end $$;

rollback;
select 'PASS 71_inv_counts_replenishment' as result;
