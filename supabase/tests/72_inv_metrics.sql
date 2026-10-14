-- Indicadores, séries, relatórios de giro/cobertura/parados e saldos valorizados sobre um conjunto de DATAS FIXAS.
-- Referência de «hoje» = 2025-06-15 (parâmetro p_today). Totais calculados à mão e documentados em docs/METRICS.md («Dados de conferência»).
--
--  Depósitos: WH1 Loja, WH2 CD. Categorias: Eletrônicos (A, C), Ferramentas (B). Produtos criados em 2024-01-01.
--  A (un; mín 5, ponto 10, alvo 50):
--    02/05 compra WH1 100 a R$ 10,00 → 100 un, 100000 | 20/05 venda 30 → 100000×30/100 = 30000 → 70/70000
--    02/06 compra 20 a R$ 15,00 (30000) → 90/100000 | 05/06 venda 10 → 100000×10/90 = 11111,11 → 11111 → 80/88889
--    06/06 transferência WH1→WH2 20 (valor 22222, consolidado intacto) → WH1 60, WH2 20 | 10/06 venda WH2 5 → 88889×5/80 = 5555,56 → 5556 → 75/83333
--    14/06 venda WH1 54 → 83333×54/75 = 59999,76 → 60000 → 21 un/23333 (WH1 6, WH2 15)
--  B (kg; regra WH1: mín 20, ponto 25): 02/05 compra 20 a R$ 5,00 (10000) | 12/06 perda 2 kg → 1000 → 18/9000 | 12/06 venda 3 kg → 9000×3/18 = 1500 → 15/7500
--  C (un): 02/05 compra 10 a R$ 20,00 (20000) → 10/20000, sem saídas.
--  Total: 23333 + 7500 + 20000 = 50833. Distribuição de A entre depósitos (23333 por 6 e 15): 6666,57 → 6667 | 16666,43 → 16666 (maior resto).

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.item(p uuid, q numeric, c numeric default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('product_id', p, 'quantity', q, 'unit_cost', c)) $$;
create function test.ts(d text) returns timestamptz language sql as $$ select (d || ' 12:00:00-03')::timestamptz $$;
create function test.k(j jsonb, key text) returns bigint language sql as $$ select (j ->> key)::bigint $$;
create function test.pick(arr jsonb, field text, val text, key text) returns text language sql as $$ select e ->> key from jsonb_array_elements(arr) e where e ->> field = val limit 1 $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid; un uuid; kg uuid; w1 uuid; w2 uuid; ce uuid; cf uuid; a uuid; b uuid; c uuid;
begin
  org := public.create_organization('Conferência Estoque', 'conferencia-estoque');
  insert into public.organization_members (organization_id, user_id, role) values (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  select id into un from public.units_of_measure where organization_id = org and symbol = 'un';
  select id into kg from public.units_of_measure where organization_id = org and symbol = 'kg';
  insert into public.warehouses (organization_id, name, code) values (org, 'Loja', 'WH1') returning id into w1;
  insert into public.warehouses (organization_id, name, code) values (org, 'CD', 'WH2') returning id into w2;
  insert into public.product_categories (organization_id, name) values (org, 'Eletrônicos') returning id into ce;
  insert into public.product_categories (organization_id, name) values (org, 'Ferramentas') returning id into cf;
  insert into public.products (organization_id, unit_id, category_id, sku, name, minimum_stock, reorder_point, target_stock) values (org, un, ce, 'A', 'Produto A', 5, 10, 50) returning id into a;
  insert into public.products (organization_id, unit_id, category_id, sku, name) values (org, kg, cf, 'B', 'Produto B') returning id into b;
  insert into public.products (organization_id, unit_id, category_id, sku, name) values (org, un, ce, 'C', 'Produto C') returning id into c;
  insert into public.reorder_rules (organization_id, product_id, warehouse_id, minimum_quantity, reorder_point) values (org, b, w1, 20, 25);
  perform set_config('t.w1', w1::text, true); perform set_config('t.w2', w2::text, true); perform set_config('t.a', a::text, true); perform set_config('t.b', b::text, true); perform set_config('t.c', c::text, true);
  perform set_config('t.ce', ce::text, true); perform set_config('t.cf', cf::text, true);
end $$;
reset role;
update public.products set created_at = timestamptz '2024-01-01 12:00:00-03';
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('Empresa B', 'empresa-b')::text, true); end $$;
reset role;

:as_oa
do $$
declare org uuid := test.t('org'); w1 uuid := test.t('w1'); w2 uuid := test.t('w2'); a uuid := test.t('a'); b uuid := test.t('b'); c uuid := test.t('c');
begin
  perform public.inv_post_entry(org, w1, 'purchase', jsonb_build_array(test.item(a, 100, 1000), test.item(b, 20, 500), test.item(c, 10, 2000)), null, null, null, test.ts('2025-05-02'), 'm-0001-xxxx');
  perform public.inv_post_issue(org, w1, 'sale', jsonb_build_array(test.item(a, 30)), null, null, test.ts('2025-05-20'), 'm-0002-xxxx');
  perform public.inv_post_entry(org, w1, 'purchase', jsonb_build_array(test.item(a, 20, 1500)), null, null, null, test.ts('2025-06-02'), 'm-0003-xxxx');
  perform public.inv_post_issue(org, w1, 'sale', jsonb_build_array(test.item(a, 10)), null, null, test.ts('2025-06-05'), 'm-0004-xxxx');
  perform public.inv_post_transfer(org, w1, w2, jsonb_build_array(test.item(a, 20)), null, test.ts('2025-06-06'), 'm-0005-xxxx');
  perform public.inv_post_issue(org, w2, 'sale', jsonb_build_array(test.item(a, 5)), null, null, test.ts('2025-06-10'), 'm-0006-xxxx');
  perform public.inv_post_issue(org, w1, 'loss', jsonb_build_array(test.item(b, 2)), null, 'quebra no transporte', test.ts('2025-06-12'), 'm-0007-xxxx');
  perform public.inv_post_issue(org, w1, 'sale', jsonb_build_array(test.item(b, 3)), null, null, test.ts('2025-06-12'), 'm-0008-xxxx');
  perform public.inv_post_issue(org, w1, 'sale', jsonb_build_array(test.item(a, 54)), null, null, test.ts('2025-06-14'), 'm-0009-xxxx');
  assert (select quantity_valued::text || '/' || total_value_cents::text from public.inventory_cost_state where product_id = a) = '21.000/23333', 'A: 21 un, R$ 233,33';
  assert (select quantity_valued::text || '/' || total_value_cents::text from public.inventory_cost_state where product_id = b) = '15.000/7500', 'B: 15 kg, R$ 75,00';
  assert (select count(*) from public.inv_reconcile(org)) = 0, 'reconciliação ok';
  raise notice 'PASS: fixture de datas fixas lançada e conferida (A 21/23333 · B 15/7500 · C 10/20000)';
end $$;
reset role;

-- ===================================================================== saldos valorizados (maior resto)
:as_oa
do $$
begin
  assert (select value_cents from public.inv_stock_view where product_id = test.t('a') and warehouse_id = test.t('w1')) = 6667, 'A em WH1: 23333×6/21 = 6666,57 → 6667 (maior resto)';
  assert (select value_cents from public.inv_stock_view where product_id = test.t('a') and warehouse_id = test.t('w2')) = 16666, 'A em WH2: 16666,43 → 16666';
  assert (select sum(v.value_cents) from public.inv_stock_view v where v.product_id = test.t('a')) = 23333, 'a soma dos depósitos fecha exatamente com o valor do produto';
  assert not exists (select 1 from public.inv_stock_view v join public.inventory_cost_state c on c.product_id = v.product_id group by v.product_id, c.total_value_cents having sum(v.value_cents) <> c.total_value_cents), 'vale para todos os produtos';
  assert (select stock_class from public.inv_stock_view where product_id = test.t('a') and warehouse_id = test.t('w1')) = 'attention' and (select stock_class from public.inv_stock_view where product_id = test.t('a') and warehouse_id = test.t('w2')) = 'normal', 'A: 6 ≤ ponto 10 (atenção) em WH1; 15 normal em WH2';
  assert (select stock_class from public.inv_stock_view where product_id = test.t('b')) = 'critical', 'B: 15 ≤ mínimo 20 da regra do depósito (crítico)';
  raise notice 'PASS: saldos valorizados — distribuição pelo maior resto e classificação';
end $$;
reset role;

-- ===================================================================== indicadores do painel (período 01/06 a 14/06, hoje = 15/06)
:as_oa
do $$
declare org uuid := test.t('org'); k jsonb;
begin
  k := public.inv_dashboard_kpis(org, date '2025-06-01', date '2025-06-14', null, null, null, null, null, date '2025-06-15');
  assert test.k(k, 'products_active') = 3 and test.k(k, 'skus_with_stock') = 3, '3 produtos ativos, todos com saldo';
  assert test.pick(k -> 'units', 'symbol', 'un', 'quantity') = '31.000' and test.pick(k -> 'units', 'symbol', 'kg', 'quantity') = '15.000', 'unidades nunca somadas entre si: 31 un · 15 kg';
  assert test.pick(k -> 'units', 'symbol', 'un', 'skus') = '2', 'dois SKUs em unidade';
  assert test.k(k, 'stock_value_cents') = 50833, 'valor gerencial 23333 + 7500 + 20000 = 50833';
  assert test.k(k, 'below_minimum') = 1 and test.k(k, 'attention') = 1 and test.k(k, 'out_of_stock') = 0, 'crítico 1 (B) · atenção 1 (A em WH1) · sem estoque 0';
  assert test.k(k -> 'entries', 'operations') = 1 and test.k(k -> 'entries', 'value_cents') = 30000 and test.pick(k -> 'entries' -> 'by_unit', 'symbol', 'un', 'quantity') = '20.000', 'entradas no período: 1 operação, R$ 300,00, 20 un';
  assert test.k(k -> 'issues', 'operations') = 4 and test.k(k -> 'issues', 'cost_cents') = 78167, 'saídas operacionais: 4 operações, custo 11111 + 5556 + 1500 + 60000 = 78167';
  assert test.pick(k -> 'issues' -> 'by_unit', 'symbol', 'un', 'quantity') = '69.000' and test.pick(k -> 'issues' -> 'by_unit', 'symbol', 'kg', 'quantity') = '3.000', '69 un e 3 kg (perda fora)';
  assert test.k(k -> 'issues', 'other_operations') = 1 and test.k(k -> 'issues', 'other_cost_cents') = 1000, 'outras saídas (perda): 1 operação, R$ 10,00';
  assert test.k(k, 'transfers') = 1, 'uma transferência (não entra em entradas nem saídas)';
  assert test.k(k, 'idle_products') = 1, 'parado: só C (sem saída operacional em 90 dias)';
  assert test.k(k, 'count_divergences') = 0 and test.k(k, 'pending_counts') = 0, 'nenhuma divergência de inventário';
  assert round((k ->> 'coverage_days_median')::numeric, 1) = 6.4 and test.k(k, 'coverage_products') = 1, 'cobertura de A = 21 ÷ (99 ÷ 30) = 6,4 dias; B tem só 1 dia com saída: não calculável';
  assert jsonb_array_length(k -> 'recent_operations') = 7, 'movimentações recentes do período (7 operações)';
  -- filtros
  k := public.inv_dashboard_kpis(org, date '2025-06-01', date '2025-06-14', test.t('w2'), null, null, null, null, date '2025-06-15');
  assert test.k(k, 'stock_value_cents') = 16666 and test.pick(k -> 'units', 'symbol', 'un', 'quantity') = '15.000', 'filtro WH2: valor 16666, 15 un';
  assert test.k(k -> 'issues', 'operations') = 1 and test.k(k -> 'issues', 'cost_cents') = 5556 and test.k(k, 'transfers') = 1, 'WH2: 1 venda (5556) e a perna de entrada da transferência';
  k := public.inv_dashboard_kpis(org, date '2025-06-01', date '2025-06-14', null, test.t('cf'), null, null, null, date '2025-06-15');
  assert test.k(k, 'products_active') = 1 and test.k(k, 'stock_value_cents') = 7500 and test.k(k -> 'issues', 'cost_cents') = 1500, 'filtro categoria Ferramentas (só B)';
  k := public.inv_dashboard_kpis(org, date '2025-06-01', date '2025-06-14', null, null, null, test.t('c'), null, date '2025-06-15');
  assert test.k(k, 'stock_value_cents') = 20000 and test.k(k -> 'issues', 'operations') = 0, 'filtro produto C';
  k := public.inv_dashboard_kpis(org, date '2025-05-01', date '2025-05-31', null, null, null, null, null, date '2025-06-15');
  assert test.k(k -> 'entries', 'operations') = 1 and test.k(k -> 'entries', 'value_cents') = 130000 and test.k(k -> 'issues', 'cost_cents') = 30000, 'maio: entrada de 100+20+10 itens (R$ 1.300,00) e venda de R$ 300,00';
  assert test.errmsg(format($q$select public.inv_dashboard_kpis(%L, date '2025-06-30', date '2025-06-01')$q$, org)) like '%período inválido%', 'período invertido';
  assert test.errmsg(format($q$select public.inv_dashboard_kpis(%L, date '2020-01-01', date '2025-06-01')$q$, org)) like '%período inválido%', 'período longo demais';
  raise notice 'PASS: indicadores do painel — valores à mão, unidades separadas e filtros';
end $$;
reset role;

-- ===================================================================== séries e gráficos
:as_oa
do $$
declare org uuid := test.t('org'); s jsonb;
begin
  s := public.inv_dashboard_series(org, date '2025-06-01', date '2025-06-14', null, null, null, null, null, date '2025-06-15');
  assert s ->> 'step' = 'day' and jsonb_array_length(s -> 'flow') = 14, 'granularidade diária, 14 pontos';
  assert test.pick(s -> 'flow', 'period', '2025-06-02', 'entry_value_cents') = '30000' and test.pick(s -> 'flow', 'period', '2025-06-02', 'entry_ops') = '1', 'entrada de 02/06';
  assert test.pick(s -> 'flow', 'period', '2025-06-05', 'issue_value_cents') = '11111' and test.pick(s -> 'flow', 'period', '2025-06-12', 'issue_value_cents') = '2500' and test.pick(s -> 'flow', 'period', '2025-06-12', 'issue_ops') = '2', 'saídas de 05/06 (11111) e 12/06 (1000 + 1500, 2 operações)';
  assert test.pick(s -> 'flow', 'period', '2025-06-06', 'issue_ops') = '0' and test.pick(s -> 'flow', 'period', '2025-06-06', 'entry_ops') = '0', 'transferência de 06/06 não vira entrada nem saída';
  assert test.pick(s -> 'value_evolution', 'period', '2025-06-01', 'value_cents') = '100000' and test.pick(s -> 'value_evolution', 'period', '2025-06-14', 'value_cents') = '50833', 'valorização: 100000 ao fim de 01/06, 50833 ao fim de 14/06';
  assert test.pick(s -> 'value_by_category', 'category', 'Eletrônicos', 'value_cents') = '43333' and test.pick(s -> 'value_by_category', 'category', 'Ferramentas', 'value_cents') = '7500', 'valor por categoria: 43333 e 7500';
  assert test.pick(s -> 'stock_by_warehouse', 'code', 'WH1', 'value_cents') = '34167' and test.pick(s -> 'stock_by_warehouse', 'code', 'WH2', 'value_cents') = '16666', 'valor por depósito: 6667 + 7500 + 20000 = 34167 e 16666 (soma 50833)';
  assert s -> 'top_issues' -> 0 ->> 'sku' = 'A' and (s -> 'top_issues' -> 0 ->> 'cost_cents') = '76667' and (s -> 'top_issues' -> 1 ->> 'cost_cents') = '1500', 'maiores saídas: A 76667 e B 1500';
  assert s -> 'below_minimum' -> 0 ->> 'sku' = 'B' and s -> 'below_minimum' -> 0 ->> 'class' = 'critical', 'lista abaixo do mínimo: B';
  assert (s -> 'status_distribution' ->> 'active')::int = 3 and (s -> 'status_distribution' ->> 'critical')::int = 1 and (s -> 'status_distribution' ->> 'attention')::int = 1, 'distribuição por situação: 3 ativos, 1 crítico, 1 atenção';
  assert test.pick(s -> 'turnover_by_category', 'category', 'Ferramentas', 'cost_cents') = '1500', 'giro por categoria em valor (custo das saídas): Ferramentas 1500';
  assert jsonb_array_length(s -> 'count_adjustments') = 14 and jsonb_array_length(s -> 'movements_by_type') = 14, 'séries de ajustes de inventário e movimentos por tipo';
  s := public.inv_dashboard_series(org, date '2025-01-01', date '2025-06-14', null, null, null, null, null, date '2025-06-15');
  assert s ->> 'step' = 'week', 'período de 5 meses: granularidade semanal';
  s := public.inv_dashboard_series(org, date '2024-06-15', date '2025-06-14', null, null, null, null, null, date '2025-06-15');
  assert s ->> 'step' = 'month' and jsonb_array_length(s -> 'flow') = 13, 'um ano: granularidade mensal (13 meses)';
  raise notice 'PASS: séries — fluxo, valorização, categoria, depósito, maiores saídas, abaixo do mínimo e situação';
end $$;
reset role;

-- ===================================================================== relatórios: giro, cobertura, parados e produto
:as_oa
do $$
declare org uuid := test.t('org'); st jsonb;
begin
  assert (select issued_qty from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'A') = 69, 'A: 69 un saídas operacionais';
  assert (select average_stock from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'A') = 75.786, 'A: estoque médio diário 1061 ÷ 14 = 75,786';
  assert (select turnover from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'A') = 0.91, 'A: giro 69 ÷ 75,786 = 0,91';
  assert (select coverage_days from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'A') = 6.4, 'A: cobertura 6,4 dias';
  assert (select last_issue_date from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'A') = date '2025-06-14', 'A: última saída 14/06';
  assert (select issued_qty from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'B') = 3 and (select turnover from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'B') = 0.16, 'B: 3 kg (a perda não conta); giro 3 ÷ 18,929 = 0,16';
  assert (select coverage_days from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'B') is null, 'B: cobertura não calculável (1 dia com saída)';
  assert (select turnover from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'C') = 0.00 and (select last_issue_date from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', null, null, date '2025-06-15') where sku = 'C') is null, 'C: giro 0 e sem saída';
  assert (select count(*) from public.inv_report_turnover(org, date '2025-06-01', date '2025-06-14', test.t('w2'), null, date '2025-06-15') where issued_qty > 0) = 1, 'filtro por depósito WH2: só A saiu';
  -- parados
  assert (select count(*) from public.inv_report_idle(org, 90, null, date '2025-06-15')) = 1 and (select sku from public.inv_report_idle(org, 90, null, date '2025-06-15')) = 'C', 'parados em 90 dias: C';
  assert (select value_cents from public.inv_report_idle(org, 90, null, date '2025-06-15')) = 20000, 'C parado imobiliza R$ 200,00';
  assert (select count(*) from public.inv_report_idle(org, 7, null, date '2025-06-15')) = 1, 'em 7 dias: A saiu em 14/06 e B em 12/06; só C';
  assert (select count(*) from public.inv_report_idle(org, 7, null, date '2025-07-01')) = 3, 'em 01/07 (7 dias): ninguém saiu desde 24/06: A, B e C parados';
  assert test.errmsg(format($q$select * from public.inv_report_idle(%L, 3)$q$, org)) like '%inválido%', 'período de parados validado';
  -- produto novo não é «parado»
  insert into public.products (organization_id, unit_id, sku, name) values (org, (select id from public.units_of_measure where organization_id = org and symbol = 'un'), 'NOVO', 'Recém-cadastrado');
  perform public.inv_post_entry(org, test.t('w1'), 'purchase', jsonb_build_array(test.item((select id from public.products where sku = 'NOVO'), 4, 100)), null, null, null, now(), 'm-novo-0001');
  assert not exists (select 1 from public.inv_report_idle(org, 90, null, private.inv_today(org)) where sku = 'NOVO'), 'produto recém-cadastrado não é classificado como parado';
  raise notice 'PASS: giro, cobertura, parados e produto recém-cadastrado — valores à mão';
end $$;
reset role;

-- ===================================================================== painel por produto
:as_oa
do $$
declare org uuid := test.t('org'); st jsonb;
begin
  st := public.inv_product_stats(org, test.t('a'), date '2025-06-01', date '2025-06-14', date '2025-06-15');
  assert (st ->> 'quantity')::numeric = 21 and (st ->> 'value_cents')::bigint = 23333 and (st ->> 'average_cost_cents')::numeric = 1111.0952, 'A: 21 un, R$ 233,33, custo médio 1111,0952 centavos';
  assert jsonb_array_length(st -> 'by_warehouse') = 2 and test.pick(st -> 'by_warehouse', 'code', 'WH1', 'value_cents') = '6667' and test.pick(st -> 'by_warehouse', 'code', 'WH2', 'class') = 'normal', 'A por depósito';
  assert (st ->> 'entries_period')::numeric = 20 and (st ->> 'issues_period')::numeric = 69 and (st ->> 'operational_issues_period')::numeric = 69, 'A: 20 entradas e 69 saídas no período';
  assert (st ->> 'last_issue_at')::timestamptz = test.ts('2025-06-14') and (st ->> 'last_entry_at')::timestamptz = test.ts('2025-06-02'), 'última entrada 02/06 e última saída 14/06';
  assert (st ->> 'coverage_days')::numeric = 6.4, 'cobertura 6,4 dias';
  assert jsonb_array_length(st -> 'balance_series') = 14 and test.pick(st -> 'balance_series', 'date', '2025-06-01', 'quantity') = '70.000' and test.pick(st -> 'balance_series', 'date', '2025-06-14', 'quantity') = '21.000', 'evolução do saldo: 70 em 01/06 → 21 em 14/06';
  assert test.pick(st -> 'balance_series', 'date', '2025-06-06', 'quantity') = '80.000', 'transferência não muda o saldo total (80 em 06/06)';
  assert jsonb_array_length(st -> 'cost_series') = 4 and test.pick(st -> 'cost_series', 'date', '2025-06-14', 'average_cost_cents') = '1111.0952', 'histórico do custo médio: 4 pontos, o último 1111,0952';
  st := public.inv_product_stats(org, test.t('b'), date '2025-06-01', date '2025-06-14', date '2025-06-15');
  assert st ->> 'coverage_days' is null and st ->> 'coverage_note' like '%poucos dias%', 'B: cobertura indisponível com justificativa, sem dividir por zero';
  st := public.inv_product_stats(org, test.t('c'), date '2025-06-01', date '2025-06-14', date '2025-06-15');
  assert st ->> 'coverage_days' is null and st ->> 'coverage_note' like '%sem consumo%', 'C: sem consumo no período';
  assert test.errmsg(format($q$select public.inv_product_stats(%L, gen_random_uuid(), date '2025-06-01', date '2025-06-14')$q$, org)) like '%produto não encontrado%', 'produto inexistente';
  raise notice 'PASS: painel por produto — saldo, custo médio, cobertura e séries';
end $$;
reset role;

-- ===================================================================== autorização
:as_va
do $$
declare org uuid := test.t('org');
begin
  assert test.k(public.inv_dashboard_kpis(org, date '2025-06-01', date '2025-06-14', null, null, null, null, null, date '2025-06-15'), 'stock_value_cents') = 51233, 'consulta lê os indicadores (50833 + produto novo de 400)';
  assert (select count(*) from public.inv_member_names(org)) = 2, 'consulta vê os nomes dos colegas';
end $$;
reset role;
:as_ob
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.inv_dashboard_kpis(%L, date '2025-06-01', date '2025-06-14')$q$, org)) like '%sem permissão%', 'outra empresa não lê indicadores';
  assert test.errmsg(format($q$select public.inv_dashboard_series(%L, date '2025-06-01', date '2025-06-14')$q$, org)) like '%sem permissão%', 'nem séries';
  assert test.errmsg(format($q$select * from public.inv_report_turnover(%L, date '2025-06-01', date '2025-06-14')$q$, org)) like '%sem permissão%', 'nem relatórios';
  assert test.errmsg(format($q$select public.inv_product_stats(%L, %L, date '2025-06-01', date '2025-06-14')$q$, org, test.t('a'))) like '%sem permissão%', 'nem painel de produto';
  assert (select count(*) from public.inv_stock_view) = 0, 'a visão de saldos não vaza para a empresa B';
  assert test.errmsg(format($q$select * from public.inv_member_names(%L)$q$, org)) like '%sem permissão%', 'nem nomes de membros';
end $$;
reset role;
:as_anon
do $$ begin
  assert test.errmsg(format($q$select public.inv_dashboard_kpis(%L, date '2025-06-01', date '2025-06-14')$q$, test.t('org'))) like '%permission denied%', 'anônimo não executa';
  assert test.errmsg($q$select count(*) from public.inv_stock_view$q$) like '%permission denied%', 'anônimo não lê a visão';
  raise notice 'PASS: indicadores, séries, relatórios e visão de saldos isolados por empresa e fechados ao anônimo';
end $$;
reset role;

rollback;
select 'PASS 72_inv_metrics' as result;
