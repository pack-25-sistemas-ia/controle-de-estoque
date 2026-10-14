-- Motor de estoque: livro, saldo, custo médio, transferência, ajuste, abertura, estorno, idempotência e permissões.
-- Valores esperados calculados à mão (centavos). Cenários:
--  P1 (un): compra 10 a R$ 20,00 (20000) + compra 10 a R$ 30,00 (30000) → 20 un, 50000, média 2500;
--           venda 4 → 50000×4/20 = 10000 → 16 un, 40000; transferência 6 (WH1→WH2) → 40000×6/16 = 15000, total consolidado intacto (16 un, 40000);
--           venda 10 em WH1 → 40000×10/16 = 25000 → 6 un, 15000; venda dos 6 restantes em WH2 → zera: leva TODO o valor (15000) → 0 un, 0.
--  P2 (kg, 3 casas): 3 kg a 333,3333 centavos/kg → round(999,9999) = 1000; saídas de 1 kg: 1000/3 = 333,33 → 333 | 667/2 = 333,5 → par → 334 | resto 333; soma = 1000 (conserva).
--                    Depois 10,500 kg a 800 → 8400; saída de 2,500 kg → 8400×2,5/10,5 = 2000 exato.
--  P3 (un): compra 10 a 10,00 (10000); venda 4 (4000) → 6 un, 6000; estorno da compra recusado (saldo 6 < 10); estorno da venda → 10 un, 10000; estorno da compra → 0, 0.

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_ad 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a4","aal":"aal1","email":"ad@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.item(p uuid, q numeric, c numeric default null, m text default null, r uuid default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('product_id', p, 'quantity', q, 'unit_cost', c, 'cost_mode', m, 'reference_movement_id', r)) $$;
create function test.bal(p uuid, w uuid) returns numeric language sql as $$ select coalesce((select quantity_on_hand from public.inventory_balances where product_id = p and warehouse_id = w), 0) $$;
create function test.cs(p uuid) returns text language sql as $$ select quantity_valued::text || '/' || total_value_cents::text from public.inventory_cost_state where product_id = p $$;
create function test.nmov() returns bigint language sql as $$ select count(*) from public.stock_movements $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a4', 'ad@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid; un uuid; kg uuid; w1 uuid; w2 uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid;
begin
  org := public.create_organization('Distribuidora Teste', 'distribuidora-teste');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer'), (org, 'ffffffff-0000-4000-8000-0000000000a4', 'admin');
  perform set_config('t.org', org::text, true);
  assert (select count(*) from public.units_of_measure where organization_id = org) = 6, 'seis unidades padrão';
  assert (select count(*) from public.inv_settings where organization_id = org) = 1, 'configuração criada com a empresa';
  select id into un from public.units_of_measure where organization_id = org and symbol = 'un';
  select id into kg from public.units_of_measure where organization_id = org and symbol = 'kg';
  insert into public.warehouses (organization_id, name, code) values (org, 'Loja', 'WH1') returning id into w1;
  insert into public.warehouses (organization_id, name, code) values (org, 'Centro de distribuição', 'WH2') returning id into w2;
  insert into public.products (organization_id, unit_id, sku, name) values (org, un, 'P1', 'Cabo USB') returning id into p1;
  insert into public.products (organization_id, unit_id, sku, name) values (org, kg, 'P2', 'Arroz a granel') returning id into p2;
  insert into public.products (organization_id, unit_id, sku, name) values (org, un, 'P3', 'Caneta') returning id into p3;
  insert into public.products (organization_id, unit_id, sku, name) values (org, un, 'P4', 'Produto empate') returning id into p4;
  perform set_config('t.p4', p4::text, true);
  perform set_config('t.w1', w1::text, true); perform set_config('t.w2', w2::text, true);
  perform set_config('t.p1', p1::text, true); perform set_config('t.p2', p2::text, true); perform set_config('t.p3', p3::text, true);
  perform set_config('t.un', un::text, true); perform set_config('t.kg', kg::text, true);
  raise notice 'PASS: empresa de teste, 3 produtos, 2 depósitos e unidades padrão';
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('Empresa B', 'empresa-b')::text, true); end $$;
reset role;

-- ===================================================================== 1. P1: custo médio, venda, transferência, zeragem
:as_na
do $$
declare org uuid := test.t('org'); op uuid; op2 uuid; k1 uuid; mv bigint;
begin
  -- operador lança compras
  op := public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p1'), 10, 2000)), null, 'NF-100', null, null, 'k-entry-0001');
  perform set_config('t.op_e1', op::text, true);
  assert test.bal(test.t('p1'), test.t('w1')) = 10 and test.cs(test.t('p1')) = '10.000/20000', 'compra 1: 10 un, R$ 200,00';
  op2 := public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p1'), 10, 3000)), null, 'NF-101', null, null, 'k-entry-0002');
  assert test.cs(test.t('p1')) = '20.000/50000', 'compra 2: 20 un, R$ 500,00 (média R$ 25,00)';
  assert (select average_cost_after from public.inventory_cost_events e join public.stock_movements m on m.id = e.movement_id where m.operation_id = op2) = 2500.0000, 'média após a compra 2 = 2500,0000';
  -- idempotência: mesma chave e mesmo conteúdo → mesma operação, sem novo movimento
  mv := test.nmov();
  assert public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p1'), 10, 3000)), null, 'NF-101', null, null, 'k-entry-0002') = op2, 'repetição devolve a mesma operação';
  assert test.nmov() = mv and test.cs(test.t('p1')) = '20.000/50000', 'repetição não duplica movimento nem valor';
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, 'NF-101', null, null, 'k-entry-0002')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p1'), 11, 3000)))) like '%outro conteúdo%', 'mesma chave com outro conteúdo é recusada';
  -- venda de 4: custo médio 25,00 → 10000
  perform public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(test.t('p1'), 4)), 'PED-1', null, null, 'k-issue-0001');
  assert test.bal(test.t('p1'), test.t('w1')) = 16 and test.cs(test.t('p1')) = '16.000/40000', 'venda de 4: 16 un, R$ 400,00';
  assert (select value_delta_cents from public.stock_movements where movement_type = 'issue' and product_id = test.t('p1')) = -10000, 'custo da venda R$ 100,00 gravado';
  assert (select balance_after from public.stock_movements where movement_type = 'issue' and product_id = test.t('p1')) = 16, 'saldo após a venda gravado';
  -- transferência de 6 para WH2: conserva quantidade e valor
  perform public.inv_post_transfer(org, test.t('w1'), test.t('w2'), jsonb_build_array(test.item(test.t('p1'), 6)), 'reforço do CD', null, 'k-trf-0001');
  assert test.bal(test.t('p1'), test.t('w1')) = 10 and test.bal(test.t('p1'), test.t('w2')) = 6, 'WH1 10 · WH2 6';
  assert test.bal(test.t('p1'), test.t('w1')) + test.bal(test.t('p1'), test.t('w2')) = 16, 'transferência não cria nem destrói unidades';
  assert test.cs(test.t('p1')) = '16.000/40000', 'valor consolidado intacto após a transferência';
  assert (select sum(quantity_delta) from public.stock_movements m join public.stock_operations o on o.id = m.operation_id where o.operation_type = 'transfer') = 0, 'pernas da transferência somam zero';
  assert (select sum(value_delta_cents) from public.stock_movements m join public.stock_operations o on o.id = m.operation_id where o.operation_type = 'transfer') = 0, 'valor das pernas soma zero';
  assert (select value_delta_cents from public.stock_movements where movement_type = 'transfer_in') = 15000, 'valor transferido 40000×6/16 = 15000';
  -- saldo insuficiente: nada é gravado
  mv := test.nmov();
  assert test.errmsg(format($q$select public.inv_post_issue(%L, %L, 'sale', %L::jsonb, null, null, null, 'k-issue-0002')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p1'), 10.001)))) like '%casa(s) decimal%', 'unidade inteira recusa fração';
  assert test.errmsg(format($q$select public.inv_post_issue(%L, %L, 'sale', %L::jsonb, null, null, null, 'k-issue-0003')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p1'), 11)))) like '%saldo insuficiente%', 'saída acima do saldo recusada (sem estoque negativo)';
  assert test.nmov() = mv and test.bal(test.t('p1'), test.t('w1')) = 10, 'falha não deixa rastro';
  -- vende 10 em WH1 (média: 40000×10/16 = 25000) e os 6 restantes em WH2 (zera: leva todo o valor)
  perform public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(test.t('p1'), 10)), null, null, null, 'k-issue-0004');
  assert test.cs(test.t('p1')) = '6.000/15000', 'após vender 10: 6 un, R$ 150,00';
  perform public.inv_post_issue(org, test.t('w2'), 'sale', jsonb_build_array(test.item(test.t('p1'), 6)), null, null, null, 'k-issue-0005');
  assert test.cs(test.t('p1')) = '0.000/0', 'zerou: nenhum centavo sobra';
  assert (select sum(value_delta_cents) from public.stock_movements where product_id = test.t('p1')) = 0, 'ledger de valor fecha em zero';
  raise notice 'PASS: custo médio ponderado, venda, transferência com conservação, idempotência e bloqueio de estoque negativo';
end $$;
reset role;

-- ===================================================================== 2. P2: frações, meio-para-o-par e conservação de centavos
:as_na
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-kg-0000')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p2'), 1.2345, 100)))) like '%casa(s) decimal%', 'kg aceita no máximo 3 casas';
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-kg-0009')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p2'), 1, 100.12345)))) like '%4 casas%', 'custo aceita no máximo 4 casas';
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-kg-0008')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p2'), 1)))) like '%custo%', 'compra sem custo recusada';
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-kg-0007')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p2'), 1, 0)))) like '%bonificação%', 'custo zero em compra exige marcar «sem custo»';
  perform public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p2'), 3, 333.3333)), null, null, null, null, 'k-kg-0001');
  assert test.cs(test.t('p2')) = '3.000/1000', '3 kg a 333,3333 = round(999,9999) = 1000';
  perform public.inv_post_issue(org, test.t('w1'), 'internal_use', jsonb_build_array(test.item(test.t('p2'), 1)), null, null, null, 'k-kg-0002');
  assert test.cs(test.t('p2')) = '2.000/667', 'saiu 333 (1000/3 = 333,33)';
  perform public.inv_post_issue(org, test.t('w1'), 'internal_use', jsonb_build_array(test.item(test.t('p2'), 1)), null, null, null, 'k-kg-0003');
  assert test.cs(test.t('p2')) = '1.000/333', 'saiu 334 (667/2 = 333,5 → arredonda para o par)';
  perform public.inv_post_issue(org, test.t('w1'), 'internal_use', jsonb_build_array(test.item(test.t('p2'), 1)), null, null, null, 'k-kg-0004');
  assert test.cs(test.t('p2')) = '0.000/0', 'a última saída leva o resto (333)';
  assert (select array_agg(value_delta_cents order by balance_after desc) from public.stock_movements where product_id = test.t('p2') and movement_type = 'issue') = array[-333, -334, -333]::bigint[], 'saídas 333 + 334 + 333';
  assert (select sum(value_delta_cents) from public.stock_movements where product_id = test.t('p2')) = 0, 'nenhum centavo criado nem perdido';
  perform public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p2'), 10.5, 800)), null, null, null, null, 'k-kg-0005');
  assert test.cs(test.t('p2')) = '10.500/8400', '10,5 kg a R$ 8,00 = 8400';
  perform public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(test.t('p2'), 2.5)), null, null, null, 'k-kg-0006');
  assert test.cs(test.t('p2')) = '8.000/6400' and test.bal(test.t('p2'), test.t('w1')) = 8, 'saída de 2,5 kg = 2000 exato';
  -- empates exatos: 2,5 centavos → 2 (par); 0,5 centavo → 0 (par); 3,5 centavos → 4 (par)
  perform public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p4'), 1, 2.5)), null, null, null, null, 'k-tie-0001');
  assert test.cs(test.t('p4')) = '1.000/2', 'meio-para-o-par: 2,5 → 2';
  perform public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p4'), 1, 0.5)), null, null, null, null, 'k-tie-0002');
  assert test.cs(test.t('p4')) = '2.000/2', 'meio-para-o-par: 0,5 → 0';
  perform public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p4'), 1, 3.5)), null, null, null, null, 'k-tie-0003');
  assert test.cs(test.t('p4')) = '3.000/6', 'meio-para-o-par: 3,5 → 4';
  raise notice 'PASS: frações por unidade, arredondamento meio-para-o-par e conservação do último centavo';
end $$;
reset role;

-- ===================================================================== 3. P3: estorno (compensatório, uma vez, nunca negativo)
:as_na
do $$
declare org uuid := test.t('org'); e3 uuid; s3 uuid;
begin
  e3 := public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p3'), 10, 1000)), null, null, null, null, 'k-p3-0001');
  s3 := public.inv_post_issue(org, test.t('w1'), 'sale', jsonb_build_array(test.item(test.t('p3'), 4)), null, null, null, 'k-p3-0002');
  perform set_config('t.e3', e3::text, true); perform set_config('t.s3', s3::text, true);
  assert test.cs(test.t('p3')) = '6.000/6000', 'compra 10 a 10,00 e venda de 4 = 6 un, R$ 60,00';
  assert test.errmsg(format($q$select public.inv_reverse_operation(%L, 'engano de lançamento', 'k-rev-0000')$q$, e3)) like '%sem permissão%', 'operador não estorna';
end $$;
reset role;
:as_ma
do $$
declare r uuid; r2 uuid; n bigint;
begin
  assert test.errmsg(format($q$select public.inv_reverse_operation(%L, 'erro', 'k-rev-0001')$q$, test.t('e3'))) like '%motivo%', 'estorno exige motivo (mínimo 5 caracteres)';
  assert test.errmsg(format($q$select public.inv_reverse_operation(%L, 'compra lançada em duplicidade', 'k-rev-0001')$q$, test.t('e3'))) like '%saldo atual%', 'estornar a compra com saldo menor é recusado';
  assert test.cs(test.t('p3')) = '6.000/6000', 'recusa não muda nada';
  r := public.inv_reverse_operation(test.t('s3'), 'venda cancelada pelo cliente', 'k-rev-0002');
  assert test.cs(test.t('p3')) = '10.000/10000' and test.bal(test.t('p3'), test.t('w1')) = 10, 'estorno da venda devolve 4 un e o valor original 4000';
  assert public.inv_reverse_operation(test.t('s3'), 'venda cancelada pelo cliente', 'k-rev-0002') = r, 'repetição do estorno (mesma chave) devolve o mesmo estorno';
  assert test.errmsg(format($q$select public.inv_reverse_operation(%L, 'tentativa repetida', 'k-rev-0003')$q$, test.t('s3'))) like '%já estornada%', 'segundo estorno da mesma operação é recusado';
  assert test.errmsg(format($q$select public.inv_reverse_operation(%L, 'estornar o estorno', 'k-rev-0004')$q$, r)) like '%não pode ser estornado%', 'estorno não é estornado';
  assert (select status from public.stock_operations where id = test.t('s3')) = 'reversed', 'operação original marcada como estornada';
  r2 := public.inv_reverse_operation(test.t('e3'), 'compra lançada em duplicidade', 'k-rev-0005');
  assert test.cs(test.t('p3')) = '0.000/0' and test.bal(test.t('p3'), test.t('w1')) = 0, 'estorno da compra zera quantidade e valor';
  select count(*) into n from public.stock_movements where reverses_movement_id is not null;
  assert n = 2, 'dois movimentos compensatórios ligados aos originais';
  assert (select count(*) from public.stock_movements where operation_id = test.t('e3')) = 1, 'movimento original preservado';
  assert test.errmsg(format($q$update public.stock_movements set reason = 'x' where operation_id = %L$q$, test.t('e3'))) like '%permission denied%', 'gestor não edita o livro';
  raise notice 'PASS: estorno compensatório — uma vez, idempotente, sem negativo e com valor original';
end $$;
reset role;

-- ===================================================================== 4. saldo inicial e ajustes (gestão, sempre justificados)
:as_ma
do $$
declare org uuid := test.t('org');
begin
  perform public.inv_post_opening(org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 5, 1000)), null, 'k-open-0001');
  assert test.bal(test.t('p3'), test.t('w1')) = 5 and test.cs(test.t('p3')) = '5.000/5000', 'saldo inicial 5 un a R$ 10,00';
  assert test.errmsg(format($q$select public.inv_post_opening(%L, %L, %L::jsonb, null, 'k-open-0002')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 5, 1000)))) like '%já lançado%', 'saldo inicial não duplica';
  assert test.errmsg(format($q$select public.inv_post_adjustment(%L, %L, 'out', 'loss', 'x', %L::jsonb, null, 'k-adj-0001')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1)))) like '%justificativa%', 'ajuste exige justificativa';
  perform public.inv_post_adjustment(org, test.t('w1'), 'out', 'loss', 'quebra na prateleira', jsonb_build_array(test.item(test.t('p3'), 1)), null, 'k-adj-0002');
  assert test.cs(test.t('p3')) = '4.000/4000', 'ajuste negativo de 1 un a R$ 10,00';
  perform public.inv_post_adjustment(org, test.t('w1'), 'in', 'count_difference', 'sobra encontrada na contagem', jsonb_build_array(test.item(test.t('p3'), 2)), null, 'k-adj-0003');
  assert test.cs(test.t('p3')) = '6.000/6000', 'ajuste positivo usa o custo médio atual (4000×2/4 = 2000)';
  assert (select cost_policy from public.stock_movements where movement_type = 'adjustment_in') = 'average', 'política de custo «média atual» registrada';
  assert test.errmsg(format($q$select public.inv_post_adjustment(%L, %L, 'in', 'other_adjustment', 'entrada sem custo conhecido', %L::jsonb, null, 'k-adj-0004')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p1'), 3)))) like '%não há custo médio%', 'sem custo médio e sem custo informado: não inventa custo';
  assert test.errmsg(format($q$select public.inv_post_adjustment(%L, %L, 'out', 'loss', 'perda além do saldo', %L::jsonb, null, 'k-adj-0005')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 7)))) like '%maior que o saldo%', 'ajuste negativo não cria estoque negativo';
  raise notice 'PASS: saldo inicial único e ajustes justificados com política de custo explícita';
end $$;
reset role;

-- ===================================================================== 5. permissões, outra empresa e depósitos autorizados
:as_na
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.inv_post_adjustment(%L, %L, 'out', 'loss', 'tentativa do operador', %L::jsonb, null, 'k-perm-0001')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1)))) like '%sem permissão%', 'operador não ajusta saldo';
  assert test.errmsg(format($q$select public.inv_post_opening(%L, %L, %L::jsonb, null, 'k-perm-0002')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1, 100)))) like '%sem permissão%', 'operador não lança saldo inicial';
end $$;
reset role;
:as_va
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-perm-0003')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1, 100)))) like '%sem permissão%', 'consulta não movimenta';
  assert (select count(*) from public.inventory_balances) > 0 and (select count(*) from public.stock_movements) > 0, 'consulta lê saldos e histórico';
  assert test.errmsg($q$insert into public.products (organization_id, unit_id, sku, name) values (current_setting('t.org')::uuid, current_setting('t.un')::uuid, 'X1', 'x')$q$) like '%row-level security%', 'consulta não cadastra produto';
end $$;
reset role;
:as_ob
do $$
declare org uuid := test.t('org'); pb uuid;
begin
  insert into public.products (organization_id, unit_id, sku, name)
    values (test.t('orgb'), (select id from public.units_of_measure where organization_id = test.t('orgb') and symbol = 'un'), 'B1', 'Produto da B') returning id into pb;
  perform set_config('t.pb', pb::text, true);
  assert (select count(*) from public.stock_movements) = 0 and (select count(*) from public.inventory_balances) = 0 and (select count(*) from public.products) = 1, 'empresa B não enxerga nada de A';
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-perm-0004')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1, 100)))) like '%sem permissão%', 'B não movimenta o estoque de A';
  assert test.errmsg(format($q$select public.inv_reverse_operation(%L, 'tentativa de outra empresa', 'k-perm-0005')$q$, test.t('e3'))) like '%sem permissão%', 'B não estorna operação de A';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-perm-0006')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('pb'), 1, 100)))) like '%produto não encontrado%', 'produto de outra empresa não entra no estoque de A';
end $$;
reset role;
:as_ad
do $$
begin
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-perm-0008')$q$, test.t('org'), test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1, 100)))) like '%duas etapas%', 'administrador sem segunda etapa é barrado no banco';
end $$;
reset role;
:as_anon
do $$
begin
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', '[]'::jsonb, null, null, null, null, 'k-perm-0007')$q$, test.t('org'), test.t('w1'))) like '%permission denied%', 'anônimo não executa o motor';
end $$;
reset role;

-- depósitos autorizados por operador
:as_oa
do $$
begin
  insert into public.warehouse_access (organization_id, user_id, warehouse_id) values (test.t('org'), 'ffffffff-0000-4000-8000-0000000000a2', test.t('w1'));
  assert test.errmsg(format($q$insert into public.warehouse_access (organization_id, user_id, warehouse_id) values (%L, 'ffffffff-0000-4000-8000-0000000000a1', %L)$q$, test.t('org'), test.t('w1'))) like '%operadores%', 'restrição só vale para operador';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org');
begin
  perform public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item(test.t('p3'), 1, 1000)), null, null, null, null, 'k-wh-0001');
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-wh-0002')$q$, org, test.t('w2'), jsonb_build_array(test.item(test.t('p3'), 1, 1000)))) like '%neste depósito%', 'operador restrito não opera em outro depósito';
  assert test.errmsg(format($q$select public.inv_post_transfer(%L, %L, %L, %L::jsonb, null, null, 'k-wh-0003')$q$, org, test.t('w1'), test.t('w2'), jsonb_build_array(test.item(test.t('p3'), 1)))) like '%destino%', 'nem transfere para depósito não autorizado';
end $$;
reset role;
:as_oa
do $$ begin delete from public.warehouse_access where organization_id = test.t('org'); raise notice 'PASS: perfis, outra empresa, anônimo e depósitos autorizados'; end $$;
reset role;

-- ===================================================================== 6. atomicidade, depósito/produto arquivado e regras de cadastro
:as_na
do $$
declare org uuid := test.t('org'); mv bigint; b1 numeric := test.bal(test.t('p3'), test.t('w1'));
begin
  mv := test.nmov();
  assert test.errmsg(format($q$select public.inv_post_transfer(%L, %L, %L, %L::jsonb, null, null, 'k-atom-0001')$q$, org, test.t('w1'), test.t('w2'), jsonb_build_array(test.item(test.t('p3'), 1), test.item(test.t('p2'), 999)))) like '%saldo insuficiente%', 'transferência com um item sem saldo falha';
  assert test.nmov() = mv and test.bal(test.t('p3'), test.t('w1')) = b1 and test.bal(test.t('p3'), test.t('w2')) = 0, 'nada foi gravado em nenhum dos lados (atômica)';
  assert test.errmsg(format($q$select public.inv_post_transfer(%L, %L, %L, %L::jsonb, null, null, 'k-atom-0002')$q$, org, test.t('w1'), test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1)))) like '%diferentes%', 'origem e destino devem ser diferentes';
  assert test.errmsg(format($q$select public.inv_post_issue(%L, %L, 'sale', %L::jsonb, null, null, null, 'k-atom-0003')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1), test.item(test.t('p3'), 1)))) like '%mais de uma vez%', 'produto repetido na operação é recusado';
  assert test.errmsg(format($q$select public.inv_post_issue(%L, %L, 'loss', %L::jsonb, null, null, null, 'k-atom-0004')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1)))) like '%observação%', 'perda exige observação';
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', '[]'::jsonb, null, null, null, null, 'k-atom-0005')$q$, org, test.t('w1'))) like '%1 a 200 itens%', 'lista vazia recusada';
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, now() + interval '2 days', 'k-atom-0006')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1, 100)))) like '%futuro%', 'data futura recusada';
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'curta')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p3'), 1, 100)))) like '%idempotência%', 'chave curta recusada';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); cx uuid;
begin
  assert test.errmsg(format($q$update public.products set archived_at = now() where id = %L$q$, test.t('p3'))) like '%saldo em estoque%', 'produto com saldo não é arquivado';
  select id into cx from public.units_of_measure where organization_id = org and symbol = 'cx';
  assert test.errmsg(format($q$update public.products set unit_id = %L where id = %L$q$, cx, test.t('p3'))) like '%unidade%', 'unidade não muda depois da primeira movimentação';
  update public.products set archived_at = now() where id = test.t('p1');
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-arch-0001')$q$, org, test.t('w1'), jsonb_build_array(test.item(test.t('p1'), 1, 100)))) like '%inativo ou arquivado%', 'produto arquivado não recebe movimento';
  update public.products set archived_at = null where id = test.t('p1');
  assert test.errmsg(format($q$update public.warehouses set active = false where id = %L$q$, test.t('w1'))) like '%saldo%', 'depósito com saldo não é arquivado';
  update public.warehouses set active = false where id = test.t('w2');
  assert test.errmsg(format($q$select public.inv_post_entry(%L, %L, 'purchase', %L::jsonb, null, null, null, null, 'k-arch-0002')$q$, org, test.t('w2'), jsonb_build_array(test.item(test.t('p3'), 1, 100)))) like '%arquivado%', 'depósito arquivado não recebe operações';
  update public.warehouses set active = true where id = test.t('w2');
  raise notice 'PASS: operação atômica, validações de lista/data/chave e regras de arquivamento';
end $$;
reset role;

-- ===================================================================== 7. cadastro (SKU, código de barras, operador) e integridade geral
:as_na
do $$
declare org uuid := test.t('org'); pn uuid;
begin
  insert into public.products (organization_id, unit_id, sku, name, barcode) values (org, test.t('un'), 'EAN-OK', 'Produto com EAN', '7891000100103') returning id into pn;
  assert test.errmsg(format($q$insert into public.products (organization_id, unit_id, sku, name, barcode) values (%L, %L, 'EAN-RUIM', 'x', '7891000100104')$q$, org, test.t('un'))) like '%código de barras inválido%', 'dígito verificador errado é recusado';
  assert test.errmsg(format($q$insert into public.products (organization_id, unit_id, sku, name, barcode) values (%L, %L, 'EAN-9', 'x', '123456789')$q$, org, test.t('un'))) like '%código de barras inválido%', 'número com tamanho inválido é recusado';
  insert into public.products (organization_id, unit_id, sku, name, barcode) values (org, test.t('un'), 'INT-1', 'Código interno', 'INT-0001');
  assert test.errmsg(format($q$insert into public.products (organization_id, unit_id, sku, name, barcode) values (%L, %L, 'OUTRO', 'x', '7891000100103')$q$, org, test.t('un'))) like '%duplicate%', 'código de barras único por empresa';
  assert test.errmsg(format($q$insert into public.products (organization_id, unit_id, sku, name) values (%L, %L, 'p1', 'duplicado')$q$, org, test.t('un'))) like '%duplicate%', 'SKU único sem diferenciar maiúsculas';
  assert test.errmsg(format($q$insert into public.products (organization_id, unit_id, sku, name, minimum_stock) values (%L, %L, 'OP-MIN', 'x', 5)$q$, org, test.t('un'))) like '%operador não define%', 'operador não define parâmetros de reposição';
  assert test.errmsg(format($q$update public.products set minimum_stock = 3 where id = %L$q$, pn)) like '%operador não altera%', 'operador não altera reposição';
  assert test.errmsg(format($q$update public.products set archived_at = now() where id = %L$q$, pn)) like '%operador não altera%', 'operador não arquiva';
end $$;
reset role;
:as_ma
do $$
declare pn uuid;
begin
  select id into pn from public.products where sku = 'EAN-OK';
  update public.products set minimum_stock = 3, reorder_point = 5, target_stock = 20 where id = pn;
  assert test.errmsg(format($q$update public.products set minimum_stock = 9 where id = %L$q$, pn)) like '%check%', 'mínimo não pode passar do ponto de reposição';
  raise notice 'PASS: SKU e código de barras (EAN-13 com dígito verificador, código interno), regras do operador e do gestor';
end $$;
reset role;

-- imutabilidade e escrita direta (até como dono do schema)
do $$
begin
  assert test.errmsg($q$update public.stock_movements set reason = 'adulterado'$q$) like '%imutável%', 'livro não é editável';
  assert test.errmsg($q$delete from public.stock_movements$q$) like '%imutável%', 'livro não é apagável';
  assert test.errmsg($q$update public.stock_operations set notes = 'adulterado'$q$) like '%imutável%', 'operação confirmada não é editável';
  assert test.errmsg($q$delete from public.stock_operations$q$) like '%não podem ser apagados%', 'operação não é apagável';
  assert test.errmsg($q$delete from public.products$q$) like '%não podem ser apagados%', 'produto com histórico não é apagado';
  assert test.errmsg($q$delete from public.inventory_balances$q$) like '%não podem ser apagados%', 'saldo não é apagado';
  assert test.errmsg($q$update public.inventory_cost_events set value_after_cents = 0$q$) like '%imutável%', 'evento de custo é imutável';
  assert test.errmsg($q$update public.inventory_balances set quantity_reserved = 1$q$) like '%check%', 'reserva fora do MVP (sempre zero)';
  assert test.errmsg($q$update public.inventory_balances set quantity_on_hand = -1$q$) like '%check%', 'saldo negativo barrado pelo banco';
end $$;
:as_oa
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$update public.inventory_balances set quantity_on_hand = 9999 where organization_id = %L$q$, org)) like '%permission denied%', 'nem o dono altera o saldo diretamente';
  assert test.errmsg(format($q$insert into public.inventory_balances (organization_id, product_id, warehouse_id, quantity_on_hand) values (%L, %L, %L, 5)$q$, org, test.t('p1'), test.t('w2'))) like '%permission denied%', 'nem o dono cria saldo';
  assert test.errmsg(format($q$insert into public.stock_movements (organization_id, operation_id, item_id, product_id, warehouse_id, movement_type, quantity_delta, value_delta_cents, balance_after, performed_by, occurred_at)
    values (%L, gen_random_uuid(), gen_random_uuid(), %L, %L, 'entry', 1, 0, 1, gen_random_uuid(), now())$q$, org, test.t('p1'), test.t('w1'))) like '%permission denied%', 'nem o dono escreve no livro';
  assert test.errmsg(format($q$update public.inventory_cost_state set total_value_cents = 1 where organization_id = %L$q$, org)) like '%permission denied%', 'nem o dono altera o custo';
  assert (select count(*) from public.inv_reconcile(org)) = 0, 'reconciliação: saldo = soma do livro, quantidade e valor de custo batem';
  raise notice 'PASS: livro, operações e saldos imutáveis/inacessíveis para escrita direta; reconciliação sem divergências';
end $$;
reset role;

rollback;
select 'PASS 70_inv_engine' as result;
