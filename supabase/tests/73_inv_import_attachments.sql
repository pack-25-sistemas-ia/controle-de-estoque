-- Importação de CSV (prévia que valida → confirmação atômica), anexos (metadados) e registro de exportações.
-- Contagens esperadas calculadas à mão em cada bloco.

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.h(s text) returns text language sql as $$ select encode(sha256(convert_to(s, 'utf8')), 'hex') $$;
create function test.js(variadic r jsonb[]) returns jsonb language sql as $$ select to_jsonb(r) $$;
create function test.kv(variadic kv text[]) returns jsonb language plpgsql as $$
declare o jsonb := '{}'; i integer;
begin for i in 1 .. cardinality(kv) / 2 loop o := o || jsonb_build_object(kv[2 * i - 1], kv[2 * i]); end loop; return o; end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid; w1 uuid;
begin
  org := public.create_organization('Importações', 'importacoes');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  insert into public.warehouses (organization_id, name, code) values (org, 'Loja', 'WH1') returning id into w1;
  perform set_config('t.w1', w1::text, true);
  insert into public.suppliers (organization_id, name) values (org, 'Fornecedor Existente');
  insert into public.products (organization_id, unit_id, sku, name) values (org, (select id from public.units_of_measure where organization_id = org and symbol = 'un'), 'JA-EXISTE', 'Produto existente');
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('Empresa B', 'empresa-b')::text, true); end $$;
reset role;

-- ===================================================================== categorias e fornecedores
:as_ma
do $$
declare org uuid := test.t('org'); r jsonb; j uuid;
begin
  r := public.inv_create_import(org, 'categories', 'categorias.csv', test.h('cat-1'), test.js(
    test.kv('name', 'Eletrônicos'), test.kv('name', 'Cabos', 'parent', 'Eletrônicos'), test.kv('name', 'Eletrônicos'), test.kv('name', 'Filhos', 'parent', 'Inexistente')));
  assert (r ->> 'total')::int = 4 and (r ->> 'valid')::int = 2 and (r ->> 'duplicates')::int = 1 and (r ->> 'errors')::int = 1, 'categorias: 4 linhas = 2 válidas + 1 repetida + 1 com erro';
  assert (select error_message from public.import_rows where job_id = (r ->> 'import_id')::uuid and row_number = 4) like '%categoria-pai%', 'erro explica a causa da linha 4';
  assert (select count(*) from public.product_categories where organization_id = org) = 0, 'a prévia não grava nada';
  j := (r ->> 'import_id')::uuid;
  perform public.inv_commit_import(j);
  assert (select count(*) from public.product_categories where organization_id = org) = 2 and (select parent_id is not null from public.product_categories where name = 'Cabos'), 'confirmação cria as 2 categorias com o pai ligado';
  assert public.inv_commit_import(j) -> 'already' = 'true'::jsonb, 'confirmar de novo não duplica';
  assert (public.inv_create_import(org, 'categories', 'categorias.csv', test.h('cat-1'), test.js(test.kv('name', 'Outra'))) ->> 'duplicate_file')::boolean, 'o mesmo arquivo não é importado duas vezes';
  r := public.inv_create_import(org, 'suppliers', 'fornecedores.csv', test.h('sup-1'), test.js(
    test.kv('name', 'Fornecedor Alfa', 'email', 'contato@alfa.com.br', 'lead_time_days', '7'), test.kv('name', 'Fornecedor Beta', 'email', 'sem-arroba'),
    test.kv('name', 'fornecedor existente'), test.kv('name', 'Fornecedor Gama', 'lead_time_days', '999')));
  assert (r ->> 'valid')::int = 1 and (r ->> 'duplicates')::int = 1 and (r ->> 'errors')::int = 2, 'fornecedores: 1 válido, 1 já cadastrado (ignora maiúsculas), 2 com erro (e-mail, prazo)';
  perform public.inv_commit_import((r ->> 'import_id')::uuid);
  assert (select count(*) from public.suppliers where organization_id = org) = 2 and (select lead_time_days from public.suppliers where name = 'Fornecedor Alfa') = 7, 'fornecedor importado com prazo';
  raise notice 'PASS: importação de categorias e fornecedores — prévia sem efeito, duplicidade, erros por linha e confirmação única';
end $$;
reset role;

-- ===================================================================== produtos (operador e gestor)
:as_na
do $$
declare org uuid := test.t('org'); r jsonb;
begin
  r := public.inv_create_import(org, 'products', 'produtos.csv', test.h('prod-1'), test.js(
    test.kv('sku', 'P-1', 'name', 'Cabo USB', 'unit', 'un', 'category', 'Cabos', 'barcode', '7891000100103'),
    test.kv('sku', 'P-2', 'name', 'Sem unidade', 'unit', 'xx'),
    test.kv('sku', 'P-3', 'name', 'Com mínimo', 'unit', 'un', 'minimum', '5', 'reorder_point', '10'),
    test.kv('sku', 'p-1', 'name', 'Repetido', 'unit', 'un'),
    test.kv('sku', 'P-4', 'name', 'EAN ruim', 'unit', 'un', 'barcode', '7891000100104'),
    test.kv('sku', 'JA-EXISTE', 'name', 'Já existe', 'unit', 'un'),
    test.kv('sku', 'P-6', 'name', 'Categoria fantasma', 'unit', 'un', 'category', 'Fantasma'),
    test.kv('sku', 'P-7', 'name', 'Quilo', 'unit', 'KG')));
  assert (r ->> 'total')::int = 8 and (r ->> 'valid')::int = 2 and (r ->> 'duplicates')::int = 2 and (r ->> 'errors')::int = 4, 'produtos: 2 válidos (P-1, P-7), 2 repetidos (p-1, JA-EXISTE), 4 com erro ' || r::text || (select string_agg(row_number || ':' || status || ':' || coalesce(error_message, ''), ' | ') from public.import_rows where job_id = (r ->> 'import_id')::uuid);
  assert (select error_message from public.import_rows where job_id = (r ->> 'import_id')::uuid and row_number = 3) like '%operador não define%', 'operador não importa parâmetros de reposição';
  assert (select error_message from public.import_rows where job_id = (r ->> 'import_id')::uuid and row_number = 5) like '%código de barras%', 'EAN com dígito errado é recusado';
  assert (select error_message from public.import_rows where job_id = (r ->> 'import_id')::uuid and row_number = 7) like '%categoria%não cadastrada%', 'categoria inexistente é recusada com orientação';
  perform public.inv_commit_import((r ->> 'import_id')::uuid);
  assert (select count(*) from public.products where organization_id = org) = 3, 'três produtos: o existente + P-1 + P-7';
  assert (select c.name from public.products p join public.product_categories c on c.id = p.category_id where p.sku = 'P-1') = 'Cabos' and (select u.symbol from public.products p join public.units_of_measure u on u.id = p.unit_id where p.sku = 'P-7') = 'kg', 'categoria e unidade resolvidas (unidade sem diferenciar maiúsculas)';
  assert test.errmsg(format($q$select public.inv_create_import(%L, 'suppliers', 'x.csv', %L, %L::jsonb)$q$, org, test.h('x'), test.js(test.kv('name', 'X')))) like '%sem permissão%', 'operador não importa fornecedores';
  assert test.errmsg(format($q$select public.inv_create_import(%L, 'opening', 'x.csv', %L, %L::jsonb)$q$, org, test.h('x2'), test.js(test.kv('sku', 'P-1')))) like '%sem permissão%', 'operador não importa saldo inicial';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); r jsonb;
begin
  r := public.inv_create_import(org, 'products', 'produtos2.csv', test.h('prod-2'), test.js(
    test.kv('sku', 'P-5', 'name', 'Com parâmetros', 'unit', 'un', 'minimum', '5', 'reorder_point', '10', 'target', '50', 'supplier', 'Fornecedor Alfa'),
    test.kv('sku', 'P-8', 'name', 'Parâmetros trocados', 'unit', 'un', 'minimum', '10', 'reorder_point', '5')));
  assert (r ->> 'valid')::int = 1 and (r ->> 'errors')::int = 1, 'gestor importa parâmetros; ordem inválida é erro';
  perform public.inv_commit_import((r ->> 'import_id')::uuid);
  assert (select minimum_stock from public.products where sku = 'P-5') = 5 and (select s.name from public.products p join public.suppliers s on s.id = p.default_supplier_id where p.sku = 'P-5') = 'Fornecedor Alfa', 'parâmetros e fornecedor principal importados';
  raise notice 'PASS: importação de produtos — unidade, categoria, EAN, duplicidade (SKU), papéis e parâmetros';
end $$;
reset role;

-- ===================================================================== saldo inicial e regras de reposição
:as_ma
do $$
declare org uuid := test.t('org'); r jsonb; p1 uuid;
begin
  select id into p1 from public.products where sku = 'P-1';
  r := public.inv_create_import(org, 'opening', 'saldo.csv', test.h('open-1'), test.js(
    test.kv('sku', 'P-1', 'warehouse', 'WH1', 'quantity', '10', 'unit_cost', '2000'),
    test.kv('sku', 'P-7', 'warehouse', 'WH1', 'quantity', '2.5', 'unit_cost', '800'),
    test.kv('sku', 'P-5', 'warehouse', 'WH1', 'quantity', '2.5', 'unit_cost', '800'),
    test.kv('sku', 'P-1', 'warehouse', 'WH1', 'quantity', '3', 'unit_cost', '2000'),
    test.kv('sku', 'P-1', 'warehouse', 'WH9', 'quantity', '3', 'unit_cost', '2000'),
    test.kv('sku', 'P-5', 'warehouse', 'WH1', 'quantity', '0', 'unit_cost', '10')));
  assert (r ->> 'valid')::int = 2 and (r ->> 'duplicates')::int = 1 and (r ->> 'errors')::int = 3, 'saldo inicial: 2 válidas (P-1 e P-7 em kg com fração), 1 repetida, 3 com erro (fração em un, depósito, quantidade zero)';
  perform public.inv_commit_import((r ->> 'import_id')::uuid);
  assert (select quantity_on_hand from public.inventory_balances where product_id = p1) = 10 and (select total_value_cents from public.inventory_cost_state where product_id = p1) = 20000, 'P-1: 10 un, R$ 200,00 (movimento de abertura)';
  assert (select quantity_on_hand from public.inventory_balances b join public.products p on p.id = b.product_id where p.sku = 'P-7') = 2.5, 'P-7: 2,5 kg';
  assert (select count(*) from public.stock_movements where movement_type = 'opening') = 2, 'dois movimentos de abertura no livro (nada de UPDATE em saldo)';
  r := public.inv_create_import(org, 'opening', 'saldo2.csv', test.h('open-2'), test.js(test.kv('sku', 'P-1', 'warehouse', 'WH1', 'quantity', '5', 'unit_cost', '2000')));
  assert (r ->> 'duplicates')::int = 1 and (select error_message from public.import_rows where job_id = (r ->> 'import_id')::uuid) like '%já lançado%', 'saldo inicial não duplica em outro arquivo';
  assert test.errmsg(format($q$select public.inv_commit_import(%L)$q$, (r ->> 'import_id')::uuid)) like '%não há linhas válidas%', 'sem linhas válidas não confirma';
  assert (select count(*) from public.inv_reconcile(org)) = 0, 'reconciliação sem divergências';
  -- regras de reposição
  r := public.inv_create_import(org, 'reorder', 'regras.csv', test.h('reo-1'), test.js(
    test.kv('sku', 'P-1', 'minimum', '3', 'reorder_point', '6', 'target', '20'),
    test.kv('sku', 'P-1', 'warehouse', 'WH1', 'minimum', '4', 'reorder_point', '8', 'target', '30', 'lead_time_days', '5'),
    test.kv('sku', 'P-1', 'warehouse', 'WH1', 'minimum', '1', 'reorder_point', '2'),
    test.kv('sku', 'NAO-EXISTE', 'minimum', '1', 'reorder_point', '2'),
    test.kv('sku', 'P-7', 'minimum', '9', 'reorder_point', '5')));
  assert (r ->> 'valid')::int = 2 and (r ->> 'duplicates')::int = 1 and (r ->> 'errors')::int = 2, 'regras: 2 válidas, 1 repetida, 2 com erro';
  perform public.inv_commit_import((r ->> 'import_id')::uuid);
  assert (select reorder_point from public.products where sku = 'P-1') = 6 and (select target_quantity from public.reorder_rules where warehouse_id = test.t('w1')) = 30, 'regra do produto e do depósito gravadas';
  raise notice 'PASS: saldo inicial vira movimento de abertura (uma vez) e regras de reposição por produto/depósito';
end $$;
reset role;

-- ===================================================================== cancelamento, papéis e isolamento
:as_na
do $$
declare org uuid := test.t('org'); r jsonb;
begin
  r := public.inv_create_import(org, 'products', 'cancelar.csv', test.h('canc-1'), test.js(test.kv('sku', 'C-1', 'name', 'Cancelável', 'unit', 'un')));
  perform public.inv_cancel_import((r ->> 'import_id')::uuid);
  assert test.errmsg(format($q$select public.inv_commit_import(%L)$q$, (r ->> 'import_id')::uuid)) like '%cancelada%', 'importação cancelada não confirma';
  assert (select count(*) from public.products where sku = 'C-1') = 0, 'nada foi criado';
  r := public.inv_create_import(org, 'products', 'ok.csv', test.h('canc-2'), test.js(test.kv('sku', 'C-2', 'name', 'Para teste', 'unit', 'un')));
  perform set_config('t.job_ok', (r ->> 'import_id'), true);
end $$;
reset role;
:as_va
do $$ begin
  assert test.errmsg(format($q$select public.inv_create_import(%L, 'products', 'x.csv', %L, %L::jsonb)$q$, test.t('org'), test.h('v1'), test.js(test.kv('sku', 'V-1')))) like '%sem permissão%', 'consulta não importa';
  assert test.errmsg(format($q$select public.inv_commit_import(%L)$q$, test.t('job_ok'))) like '%sem permissão%', 'consulta não confirma';
  assert (select count(*) from public.import_jobs) >= 6, 'consulta enxerga o histórico de importações';
end $$;
reset role;
:as_ob
do $$ begin
  assert (select count(*) from public.import_jobs) = 0 and (select count(*) from public.import_rows) = 0, 'empresa B não enxerga importações de A';
  assert test.errmsg(format($q$select public.inv_commit_import(%L)$q$, test.t('job_ok'))) like '%sem permissão%', 'B não confirma importação de A';
  assert test.errmsg(format($q$select public.inv_create_import(%L, 'products', 'x.csv', %L, %L::jsonb)$q$, test.t('org'), test.h('b1'), test.js(test.kv('sku', 'B-1')))) like '%sem permissão%', 'B não importa para A';
  assert test.errmsg(format($q$update public.import_rows set status = 'valid' where job_id = %L$q$, test.t('job_ok'))) like '%permission denied%', 'ninguém altera linhas de importação diretamente';
  raise notice 'PASS: cancelamento, papéis (consulta/operador) e isolamento entre empresas na importação';
end $$;
reset role;

-- ===================================================================== anexos
:as_na
do $$
declare org uuid := test.t('org'); p1 uuid; a1 uuid; a2 uuid; op uuid; pth text;
begin
  select id into p1 from public.products where sku = 'P-1';
  pth := org::text || '/' || gen_random_uuid()::text || '.png';
  a1 := public.inv_register_attachment(org, 'product_image', p1, E'foto\n.png', pth, 'image/png', 20480);
  assert (select image_path from public.products where id = p1) = pth, 'imagem do produto ligada ao cadastro';
  assert (select original_file_name from public.attachments where id = a1) = 'foto.png', 'caracteres de controle removidos do nome';
  assert test.errmsg(format($q$select public.inv_register_attachment(%L, 'product_image', %L, 'outra.png', %L, 'image/png', 100)$q$, org, p1, org::text || '/' || gen_random_uuid()::text || '.png')) like '%já tem imagem%', 'um produto tem uma imagem ativa';
  assert test.errmsg(format($q$select public.inv_register_attachment(%L, 'product_image', %L, 'doc.pdf', %L, 'application/pdf', 100)$q$, org, (select id from public.products where sku = 'P-7'), org::text || '/' || gen_random_uuid()::text || '.pdf')) like '%inválido%', 'imagem de produto não aceita PDF';
  assert test.errmsg(format($q$select public.inv_register_attachment(%L, 'operation', %L, 'x.pdf', %L, 'application/pdf', 100)$q$, org, gen_random_uuid(), org::text || '/' || gen_random_uuid()::text || '.pdf')) like '%operação não encontrada%', 'anexo precisa de operação existente';
  assert test.errmsg(format($q$select public.inv_register_attachment(%L, 'operation', %L, 'x.pdf', %L, 'application/pdf', 100)$q$, org, (select id from public.stock_operations limit 1), gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.pdf')) like '%inválido%', 'caminho de outra empresa é recusado';
  op := (select id from public.stock_operations limit 1);
  a2 := public.inv_register_attachment(org, 'operation', op, 'nota.pdf', org::text || '/' || gen_random_uuid()::text || '.pdf', 'application/pdf', 5000);
  assert a2 is not null, 'comprovante de operação registrado';
  assert test.errmsg(format($q$select public.inv_archive_attachment(%L)$q$, a2)) like '%sem permissão%', 'operador não arquiva comprovante de operação';
  perform public.inv_archive_attachment(a1);
  assert (select image_path from public.products where id = p1) is null, 'arquivar a imagem limpa o cadastro';
end $$;
reset role;
:as_va
do $$ begin
  assert test.errmsg(format($q$select public.inv_register_attachment(%L, 'operation', %L, 'x.pdf', %L, 'application/pdf', 100)$q$, test.t('org'), (select id from public.stock_operations limit 1), test.t('org')::text || '/' || gen_random_uuid()::text || '.pdf')) like '%sem permissão%', 'consulta não anexa';
  assert (select count(*) from public.attachments) = 2, 'consulta lê os metadados';
end $$;
reset role;
:as_ob
do $$ begin assert (select count(*) from public.attachments) = 0, 'empresa B não enxerga anexos de A'; end $$;
reset role;
do $$ begin
  assert test.errmsg($q$update public.attachments set original_file_name = 'adulterado'$q$) like '%imutáveis%', 'metadados do anexo são imutáveis (até para o dono do schema)';
  assert test.errmsg($q$delete from public.attachments$q$) like '%não podem ser apagados%', 'anexo não é apagado';
  raise notice 'PASS: anexos — imagem única do produto, tipo e tamanho, vínculo e empresa, papéis e imutabilidade';
end $$;

-- ===================================================================== exportações auditadas
:as_ma
do $$
declare org uuid := test.t('org');
begin
  perform public.inv_log_export(org, 'saldos', 42);
  assert test.errmsg(format($q$select public.inv_log_export(%L, 'Relatório!', 1)$q$, org)) like '%inválido%', 'nome do relatório validado';
end $$;
reset role;
:as_na
do $$ begin assert test.errmsg(format($q$select public.inv_log_export(%L, 'saldos', 1)$q$, test.t('org'))) like '%sem permissão%', 'operador não exporta'; end $$;
reset role;
:as_va
do $$ begin assert test.errmsg(format($q$select public.inv_log_export(%L, 'saldos', 1)$q$, test.t('org'))) like '%sem permissão%', 'consulta não exporta'; end $$;
reset role;
do $$ begin
  assert (select count(*) from public.audit_log where action = 'export') = 1 and (select changes ->> 'rows' from public.audit_log where action = 'export') = '42', 'exportação registrada com o número de linhas';
  assert (select count(*) from public.audit_log where action = 'export' and changes::text ~ '[0-9]{4,}') = 0, 'nenhum valor na trilha de exportação';
  raise notice 'PASS: exportação só para gestão, auditada sem valores';
end $$;

rollback;
select 'PASS 73_inv_import_attachments' as result;
