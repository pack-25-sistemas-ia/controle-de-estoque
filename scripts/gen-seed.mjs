#!/usr/bin/env node
// Gera supabase/seed.sql — dados de DEMONSTRAÇÃO fictícios e determinísticos da «Casa Boa Distribuidora Ltda.».
// Rode: node scripts/gen-seed.mjs
//
// Princípio: TUDO que movimenta estoque nasce pelas MESMAS funções do sistema (inv_post_opening, inv_post_entry, inv_post_issue,
// inv_post_transfer, inv_post_adjustment, inv_reverse_operation, inventário físico…), com a sessão do proprietário simulada por claims.
// Assim o livro, os saldos, o custo médio e a auditoria são consistentes por construção e nenhum indicador é digitado à mão.
// O gerador acompanha o saldo de cada produto/depósito para nunca pedir uma saída maior que o saldo. As datas são relativas ao dia
// em que o banco é criado («N dias atrás»). Só vale para ambiente local/demonstração: usuários @demo.exemplo com senha local. NUNCA use em produção.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sq = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

let seed = 20270701;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (l) => l[Math.floor(rnd() * l.length)];
const chance = (p) => rnd() < p;

export const ORG = 'e7e7e7e7-0000-4000-8000-000000000001';
const uid = (k) => `e7e7e7e7-0000-4000-8000-000000000${k}`;
const U = { owner: '0a1', manager: '0a2', operator: '0a3', viewer: '0a4', operatorLoja: '0a5' };

const WAREHOUSES = [['LOJA', 'Loja Centro', 'Rua das Palmeiras, 120 (endereço fictício)'], ['CD', 'Centro de distribuição', 'Av. dos Armazéns, 500 (endereço fictício)'], ['APOIO', 'Estoque de apoio', 'Galpão anexo (fictício)']];
const SUPPLIERS = [
  ['Tecnoimport Distribuidora', 'Importadora Tecno Ltda', '12345670000101', 7], ['Papelaria Atacadão', 'Atacadão de Papelaria Ltda', '23456780000102', 5],
  ['Limpa Mais Produtos', 'Limpa Mais Indústria Ltda', '34567890000103', 10], ['Ferramentas Brasil', 'Ferramentas Brasil S.A.', '45678900000104', 14], ['Insumos do Sul', 'Insumos do Sul Ltda', '56789010000105', 21],
];
// [categoria-pai, subcategoria|null, sku-prefixo, unidade, [[nome, custo em reais]], fornecedor]
const CATALOG = [
  ['Eletrônicos', 'Cabos e adaptadores', 'CAB', 'un', [['Cabo USB-C 1 m', 12.9], ['Cabo HDMI 2 m', 21.5], ['Adaptador OTG USB-C', 8.4], ['Carregador de parede 20 W', 34.9], ['Fonte bivolt 12 V 2 A', 27.8], ['Cabo de rede Cat6 5 m', 18.6]], 0],
  ['Eletrônicos', 'Periféricos', 'PER', 'un', [['Mouse óptico sem fio', 29.9], ['Teclado ABNT2 USB', 49.9], ['Webcam HD 720p', 89], ['Headset com microfone', 64.5], ['Hub USB 4 portas', 38.2], ['Mousepad grande', 19.9]], 0],
  ['Escritório', 'Papelaria', 'PAP', 'pct', [['Papel sulfite A4 500 folhas', 22.4], ['Caneta esferográfica azul (cx 50)', 31.9], ['Grampeador de mesa', 24.5], ['Pasta suspensa (pct 10)', 17.3], ['Bloco de notas adesivas', 6.9], ['Clipes niquelados (cx)', 4.8]], 1],
  ['Limpeza', null, 'LMP', 'un', [['Papel higiênico folha dupla (pct 12)', 14.9], ['Esponja multiuso (pct 3)', 5.2], ['Pano de microfibra', 7.5], ['Saco de lixo 100 L (pct 20)', 16.8], ['Luva de borracha M', 6.4]], 2],
  ['Limpeza', 'A granel', 'LMG', 'L', [['Detergente neutro', 3.9], ['Desinfetante floral', 4.7], ['Água sanitária', 2.9], ['Álcool líquido 70%', 6.8]], 2],
  ['Ferramentas', null, 'FER', 'un', [['Alicate universal 8"', 32.9], ['Chave de fenda 1/4"', 11.9], ['Martelo de unha 25 mm', 28.5], ['Trena 5 m', 15.4], ['Fita isolante 20 m', 4.9], ['Jogo de chaves Allen', 22.7]], 3],
  ['Insumos', 'A granel', 'INS', 'kg', [['Cimento CP-II', 1.45], ['Areia lavada', 0.38], ['Argamassa AC-I', 0.92], ['Parafuso sextavado (granel)', 18.9]], 4],
  ['Insumos', 'Metragem', 'MET', 'm', [['Fio flexível 2,5 mm²', 2.35], ['Cabo de aço 3 mm', 4.9], ['Mangueira de jardim', 3.6]], 4],
];
const IDLE_SKUS = new Set(['LMP-005', 'FER-006', 'PER-006']); // cadastrados e com estoque, mas nunca vendidos (produtos parados)

// ---------------------------------------------------------------------------- catálogo e saldos simulados
const products = [];
CATALOG.forEach(([parent, sub, pre, unit, list, sup]) => {
  list.forEach(([name, cost], i) => {
    const sku = `${pre}-${String(i + 1).padStart(3, '0')}`;
    const frac = unit === 'kg' || unit === 'L' || unit === 'm';
    products.push({ sku, name, parent, sub, unit, cost, sup, frac, ean: (products.length % 3) !== 2, price: Math.round(cost * (1.4 + rnd() * 0.5) * 100) });
  });
});
const ean13 = (n) => {
  const body = `789${String(100000000 + n * 7919).slice(0, 9)}`;
  let s = 0;
  for (let i = 1; i <= 12; i++) s += Number(body[i - 1]) * ((13 - i) % 2 === 1 ? 3 : 1);
  return body + ((10 - (s % 10)) % 10);
};
products.forEach((p, i) => { p.barcode = p.ean ? ean13(i + 1) : `INT-${String(i + 1).padStart(4, '0')}`; });

const stock = {}; // stock[sku][wh] = quantidade
const S = (sku, wh) => (stock[sku] ??= { LOJA: 0, CD: 0, APOIO: 0 })[wh];
const setS = (sku, wh, v) => { (stock[sku] ??= { LOJA: 0, CD: 0, APOIO: 0 })[wh] = Math.round(v * 1000) / 1000; };
const q = (p, a, b) => (p.frac ? Math.round((a + rnd() * (b - a)) * 10) / 10 : int(Math.ceil(a), Math.floor(b)));

const sql = [];
let n = 0;
const key = (p) => `seed-${p}-${String(++n).padStart(4, '0')}`;
const op = (fn, args) => sql.push(`${fn}(${args.join(', ')})`);
const itemsJson = (items) => `'${JSON.stringify(items).replace(/'/g, "''")}'::jsonb`;

// 1) saldo inicial há 119 dias (a data do saldo de abertura): LOJA pouco, CD muito, APOIO só alguns
const OPEN_AGO = 119;
for (const wh of ['LOJA', 'CD', 'APOIO']) {
  const items = [];
  for (const p of products) {
    if (wh === 'APOIO' && !chance(0.45)) continue;
    const base = wh === 'LOJA' ? q(p, 12, 45) : wh === 'CD' ? q(p, 80, 300) : q(p, 8, 40);
    items.push({ sku: p.sku, quantity: base, unit_cost: Math.round(p.cost * 100 * (0.92 + rnd() * 0.16) * 100) / 100, cost_mode: 'informed' });
    setS(p.sku, wh, base);
  }
  op('pg_temp.opening', [sq(wh), itemsJson(items), OPEN_AGO, sq(key('open'))]);
}

// 2) 119 dias de operação
const sellable = products.filter((p) => !IDLE_SKUS.has(p.sku));
for (let d = OPEN_AGO - 1; d >= 0; d--) {
  const dow = (new Date(Date.now() - d * 86_400_000).getUTCDay());
  const weekday = dow >= 1 && dow <= 5;
  // vendas na loja
  const sales = weekday ? int(1, 3) : chance(0.5) ? 1 : 0;
  for (let i = 0; i < sales; i++) {
    const items = [];
    for (const p of [...new Set(Array.from({ length: int(1, 4) }, () => pick(sellable)))]) {
      const want = q(p, 1, p.frac ? 6 : 5);
      if (S(p.sku, 'LOJA') >= want) { items.push({ sku: p.sku, quantity: want }); setS(p.sku, 'LOJA', S(p.sku, 'LOJA') - want); }
    }
    if (items.length) op('pg_temp.issue', [sq('LOJA'), sq('sale'), itemsJson(items), sq(`PED-${String(d)}${i}`), 'null', d, sq(key('sale'))]);
  }
  // consumo interno ocasional (CD)
  if (chance(0.12)) {
    const p = pick(sellable);
    const want = q(p, 1, 4);
    if (S(p.sku, 'CD') >= want) { setS(p.sku, 'CD', S(p.sku, 'CD') - want); op('pg_temp.issue', [sq('CD'), sq('internal_use'), itemsJson([{ sku: p.sku, quantity: want }]), 'null', 'null', d, sq(key('use'))]); }
  }
  // perdas e avarias
  if (chance(0.07)) {
    const p = pick(sellable);
    const wh = pick(['LOJA', 'CD']);
    const want = q(p, 1, 3);
    if (S(p.sku, wh) >= want) { setS(p.sku, wh, S(p.sku, wh) - want); op('pg_temp.issue', [sq(wh), sq(pick(['loss', 'damage'])), itemsJson([{ sku: p.sku, quantity: want }]), 'null', sq(pick(['Caixa molhada no recebimento', 'Item danificado na prateleira', 'Embalagem rasgada no transporte'])), d, sq(key('loss'))]); }
  }
  // transferência semanal CD → LOJA (repõe o que a loja mais vendeu)
  if (d % 7 === 3) {
    const items = [];
    for (const p of sellable) if (S(p.sku, 'LOJA') < (p.frac ? 20 : 15) && S(p.sku, 'CD') > 60) { const mv = p.frac ? 30 : 25; items.push({ sku: p.sku, quantity: mv }); setS(p.sku, 'CD', S(p.sku, 'CD') - mv); setS(p.sku, 'LOJA', S(p.sku, 'LOJA') + mv); }
    if (items.length) op('pg_temp.transfer', [sq('CD'), sq('LOJA'), itemsJson(items.slice(0, 12)), sq('Reposição semanal da loja'), d, sq(key('trf'))]);
  }
  // compras quinzenais no CD, por fornecedor
  if (d % 14 === 5) {
    const si = int(0, SUPPLIERS.length - 1);
    const items = [];
    for (const p of products.filter((x) => x.sup === si)) { const qty = q(p, 60, 200); items.push({ sku: p.sku, quantity: qty, unit_cost: Math.round(p.cost * 100 * (0.9 + rnd() * 0.25) * 100) / 100, cost_mode: 'informed' }); setS(p.sku, 'CD', S(p.sku, 'CD') + qty); }
    if (items.length) op('pg_temp.entry', [sq('CD'), sq('purchase'), sq(SUPPLIERS[si][0]), itemsJson(items), sq(`NF-${3000 + n}`), 'null', d, sq(key('buy'))]);
  }
  // devolução de cliente rara (custo médio atual)
  if (d === 40) { const p = products[3]; setS(p.sku, 'LOJA', S(p.sku, 'LOJA') + 2); op('pg_temp.entry', [sq('LOJA'), sq('customer_return'), 'null', itemsJson([{ sku: p.sku, quantity: 2, cost_mode: 'average' }]), sq('DEV-0007'), sq('Cliente devolveu por defeito de fábrica'), d, sq(key('ret'))]); }
}

// 3) ajustes do gestor, estorno e inventários
const adjP = products[8];
setS(adjP.sku, 'CD', S(adjP.sku, 'CD') - 3);
op('pg_temp.adjust', [sq('CD'), sq('out'), sq('damage'), sq('Três unidades molhadas em vazamento do telhado'), itemsJson([{ sku: adjP.sku, quantity: 3 }]), 30, sq(key('adj'))]);
const adjP2 = products[14];
setS(adjP2.sku, 'LOJA', S(adjP2.sku, 'LOJA') + 4);
op('pg_temp.adjust', [sq('LOJA'), sq('in'), sq('count_difference'), sq('Sobra encontrada na prateleira durante a conferência'), itemsJson([{ sku: adjP2.sku, quantity: 4, cost_mode: 'average' }]), 22, sq(key('adj'))]);
// uma entrada lançada em duplicidade e estornada pelo gestor
const dupP = products[20];
const dupKey = key('dup');
op('pg_temp.entry_and_reverse', [sq('LOJA'), itemsJson([{ sku: dupP.sku, quantity: 6, unit_cost: Math.round(dupP.cost * 100), cost_mode: 'informed' }]), 12, sq(dupKey), sq('Entrada digitada duas vezes por engano; estornada.')]);

// inventário concluído da LOJA (há 8 dias) com algumas divergências
op('pg_temp.count_loja', [8]);
// inventário do APOIO em contagem e do CD aguardando aprovação
op('pg_temp.count_open', []);

// 4) pressão final: itens abaixo do mínimo / sem estoque (para o painel e a reposição)
const low = [products[0], products[1], products[9], products[16]];
for (const p of low) { const have = S(p.sku, 'LOJA'); if (have > 3) { const out = have - (p.frac ? 2 : 2); setS(p.sku, 'LOJA', S(p.sku, 'LOJA') - out); op('pg_temp.issue', [sq('LOJA'), sq('sale'), itemsJson([{ sku: p.sku, quantity: out }]), sq('PED-FINAL'), 'null', 1, sq(key('low'))]); } }
const zero = products[5];
for (const wh of ['LOJA', 'CD', 'APOIO']) if (S(zero.sku, wh) > 0) { const out = S(zero.sku, wh); setS(zero.sku, wh, 0); op('pg_temp.issue', [sq(wh), sq('sale'), itemsJson([{ sku: zero.sku, quantity: out }]), sq('PED-ZERO'), 'null', 0, sq(key('zero'))]); }

// ---------------------------------------------------------------------------- funções temporárias do seed
const helpers = `
create function pg_temp.org() returns uuid language sql as $f$ select '${ORG}'::uuid $f$;
create function pg_temp.wh(p_code text) returns uuid language sql as $f$ select id from public.warehouses where organization_id = pg_temp.org() and code = p_code $f$;
create function pg_temp.sup(p_name text) returns uuid language sql as $f$ select id from public.suppliers where organization_id = pg_temp.org() and name = p_name $f$;
create function pg_temp.ts(p_days int) returns timestamptz language sql as $f$ select least((((now() at time zone 'America/Sao_Paulo')::date - p_days)::timestamp + interval '10 hours 30 minutes') at time zone 'America/Sao_Paulo', now() - interval '1 minute') $f$;
create function pg_temp.items(p jsonb) returns jsonb language sql as $f$
  select jsonb_agg((e - 'sku') || jsonb_build_object('product_id', (select id from public.products where organization_id = pg_temp.org() and sku = e ->> 'sku')) order by o) from jsonb_array_elements(p) with ordinality as t(e, o) $f$;

create function pg_temp.opening(p_wh text, p_items jsonb, p_days int, p_key text) returns void language plpgsql as $f$
begin perform public.inv_post_opening(pg_temp.org(), pg_temp.wh(p_wh), pg_temp.items(p_items), pg_temp.ts(p_days), p_key); end $f$;
create function pg_temp.entry(p_wh text, p_reason text, p_sup text, p_items jsonb, p_ref text, p_notes text, p_days int, p_key text) returns void language plpgsql as $f$
begin perform public.inv_post_entry(pg_temp.org(), pg_temp.wh(p_wh), p_reason, pg_temp.items(p_items), pg_temp.sup(p_sup), p_ref, p_notes, pg_temp.ts(p_days), p_key); end $f$;
create function pg_temp.issue(p_wh text, p_reason text, p_items jsonb, p_ref text, p_notes text, p_days int, p_key text) returns void language plpgsql as $f$
begin perform public.inv_post_issue(pg_temp.org(), pg_temp.wh(p_wh), p_reason, pg_temp.items(p_items), p_ref, p_notes, pg_temp.ts(p_days), p_key); end $f$;
create function pg_temp.transfer(p_src text, p_dst text, p_items jsonb, p_notes text, p_days int, p_key text) returns void language plpgsql as $f$
begin perform public.inv_post_transfer(pg_temp.org(), pg_temp.wh(p_src), pg_temp.wh(p_dst), pg_temp.items(p_items), p_notes, pg_temp.ts(p_days), p_key); end $f$;
create function pg_temp.adjust(p_wh text, p_dir text, p_reason text, p_just text, p_items jsonb, p_days int, p_key text) returns void language plpgsql as $f$
begin perform public.inv_post_adjustment(pg_temp.org(), pg_temp.wh(p_wh), p_dir, p_reason, p_just, pg_temp.items(p_items), pg_temp.ts(p_days), p_key); end $f$;
create function pg_temp.entry_and_reverse(p_wh text, p_items jsonb, p_days int, p_key text, p_reason text) returns void language plpgsql as $f$
declare o uuid;
begin
  o := public.inv_post_entry(pg_temp.org(), pg_temp.wh(p_wh), 'purchase', pg_temp.items(p_items), null, 'NF-DUP', 'Lançamento duplicado', pg_temp.ts(p_days), p_key);
  perform public.inv_reverse_operation(o, p_reason, p_key || '-rev');
end $f$;

-- Inventário concluído da LOJA: conta todos os itens com saldo, com 4 divergências (2 faltas, 1 sobra com média, 1 sobra pequena).
create function pg_temp.count_loja(p_days int) returns void language plpgsql as $f$
declare c uuid; r record; k int := 0; diff numeric;
begin
  c := public.inv_create_count(pg_temp.org(), pg_temp.wh('LOJA'), 'Inventário geral da loja', null, 'Contagem de rotina trimestral (dados fictícios)');
  for r in select i.id, i.expected_quantity from public.physical_count_items i where i.count_id = c order by i.id loop
    k := k + 1;
    diff := case when k = 3 then -2 when k = 11 then -1 when k = 17 then 3 when k = 23 then 1 else 0 end;
    perform public.inv_count_record(r.id, greatest(r.expected_quantity + diff, 0), case when diff <> 0 then 'Diferença conferida duas vezes' else null end);
  end loop;
  perform public.inv_submit_count(c);
  perform public.inv_approve_count(c);
  update public.physical_counts set started_at = pg_temp.ts(p_days), completed_at = pg_temp.ts(p_days - 1), created_at = pg_temp.ts(p_days) where id = c;
end $f$;

create function pg_temp.count_open() returns void language plpgsql as $f$
declare c uuid; r record; k int := 0;
begin
  -- APOIO: em contagem, com metade dos itens já contados
  c := public.inv_create_count(pg_temp.org(), pg_temp.wh('APOIO'), 'Conferência do estoque de apoio', null, 'Em andamento');
  for r in select i.id, i.expected_quantity from public.physical_count_items i where i.count_id = c order by i.id loop
    k := k + 1;
    exit when k > 6;
    perform public.inv_count_record(r.id, r.expected_quantity, null);
  end loop;
  -- CD: contagem de 6 produtos já enviada e aguardando aprovação do gestor
  c := public.inv_create_count(pg_temp.org(), pg_temp.wh('CD'), 'Conferência dos eletrônicos do CD', pg_temp.sku_ids(array['CAB-001', 'CAB-002', 'PER-001', 'PER-002', 'PAP-001', 'LMP-001']), null);
  for r in select i.id, i.expected_quantity from public.physical_count_items i where i.count_id = c order by i.id loop
    perform public.inv_count_record(r.id, r.expected_quantity - (case when k = 2 then 1 else 0 end), null);
    k := k + 1;
  end loop;
  perform public.inv_submit_count(c);
end $f$;

create function pg_temp.sku_ids(p_skus text[]) returns uuid[] language sql as $f$ select array_agg(id) from public.products where organization_id = pg_temp.org() and sku = any (p_skus) $f$;
`;

const prelude = `
do $seed$
declare
  org uuid := '${ORG}';
  pw text := extensions.crypt('DemoLocal#2026', extensions.gen_salt('bf'));
begin
  if exists (select 1 from public.organizations where id = org) then return; end if; -- já semeado
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nome), now(), now(), '', '', '', ''
  from (values
    ('${uid(U.owner)}', 'dono@demo.exemplo', 'Marcos Viana'), ('${uid(U.manager)}', 'gestor@demo.exemplo', 'Tatiana Lopes'),
    ('${uid(U.operator)}', 'operador@demo.exemplo', 'Eduardo Faria'), ('${uid(U.viewer)}', 'consulta@demo.exemplo', 'Renata Campos'),
    ('${uid(U.operatorLoja)}', 'operador.loja@demo.exemplo', 'Gustavo Brandão')
  ) as v(id, email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
  insert into public.organizations (id, name, slug) values (org, 'Casa Boa Distribuidora Ltda. (dados fictícios)', 'casa-boa');
  insert into public.organization_settings (organization_id, display_name, theme) values (org, 'Casa Boa Distribuidora', '{"primary":"#0e7490"}'::jsonb);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, '${uid(U.owner)}', 'owner'), (org, '${uid(U.manager)}', 'manager'), (org, '${uid(U.operator)}', 'member'), (org, '${uid(U.viewer)}', 'viewer'), (org, '${uid(U.operatorLoja)}', 'member');
  -- cadastros (unidades e configuração nascem por gatilho)
  insert into public.warehouses (organization_id, name, code, address) values ${WAREHOUSES.map(([c, nm, ad]) => `(org, ${sq(nm)}, ${sq(c)}, ${sq(ad)})`).join(', ')};
  insert into public.suppliers (organization_id, name, legal_name, document_number, email, phone, lead_time_days) values
    ${SUPPLIERS.map(([nm, legal, doc, lt], i) => `(org, ${sq(nm)}, ${sq(legal)}, ${sq(doc)}, ${sq(`vendas${i + 1}@fornecedor.exemplo`)}, ${sq(`(11) 4000-30${i}0`)}, ${lt})`).join(',\n    ')};
  insert into public.product_categories (organization_id, name) values ${[...new Set(CATALOG.map((c) => c[0]))].map((nm) => `(org, ${sq(nm)})`).join(', ')};
  ${[...new Set(CATALOG.filter((c) => c[1]).map((c) => `${c[0]}|${c[1]}`))].map((x) => { const [par, nm] = x.split('|'); return `insert into public.product_categories (organization_id, parent_id, name) select org, p.id, ${sq(nm)} from public.product_categories p where p.organization_id = org and p.name = ${sq(par)} and p.parent_id is null;`; }).join('\n  ')}
  -- localizações internas da loja
  insert into public.warehouse_locations (organization_id, warehouse_id, code, name) select org, w.id, x.code, x.name from public.warehouses w, (values ('A', 'Corredor A'), ('B', 'Corredor B'), ('C', 'Balcão')) as x(code, name) where w.organization_id = org and w.code = 'LOJA';
  -- operador restrito à loja
  insert into public.warehouse_access (organization_id, user_id, warehouse_id) select org, '${uid(U.operatorLoja)}', w.id from public.warehouses w where w.organization_id = org and w.code = 'LOJA';
  -- produtos
  ${products.map((p) => {
    const cat = p.sub ?? p.parent;
    const par = p.sub ? ` and c.parent_id is not null and exists (select 1 from public.product_categories pp where pp.id = c.parent_id and pp.name = ${sq(p.parent)})` : ' and c.parent_id is null';
    const mn = chance(0.65) ? (p.frac ? int(20, 60) : int(8, 25)) : null;
    const params = mn === null ? ['null', 'null', 'null'] : [mn, mn + (p.frac ? 30 : 12), mn + (p.frac ? 140 : 60)];
    return `insert into public.products (organization_id, category_id, unit_id, sku, barcode, name, product_type, list_price_cents, minimum_stock, reorder_point, target_stock, default_supplier_id) select org, (select c.id from public.product_categories c where c.organization_id = org and c.name = ${sq(cat)}${par}), (select u.id from public.units_of_measure u where u.organization_id = org and u.symbol = ${sq(p.unit)}), ${sq(p.sku)}, ${sq(p.barcode)}, ${sq(p.name)}, ${sq(p.parent === 'Insumos' ? 'raw_material' : p.parent === 'Limpeza' ? 'consumable' : 'merchandise')}::public.inv_product_type, ${p.price}, ${params.join(', ')}, (select s.id from public.suppliers s where s.organization_id = org and s.name = ${sq(SUPPLIERS[p.sup][0])});`;
  }).join('\n  ')}
  -- associação produto × fornecedor (o principal é o preferencial; metade dos produtos tem um segundo fornecedor)
  insert into public.product_suppliers (organization_id, product_id, supplier_id, supplier_sku, lead_time_days, is_preferred)
  select org, p.id, p.default_supplier_id, 'F-' || p.sku, s.lead_time_days, true from public.products p join public.suppliers s on s.id = p.default_supplier_id where p.organization_id = org;
  insert into public.product_suppliers (organization_id, product_id, supplier_id, supplier_sku, lead_time_days, is_preferred)
  select org, p.id, s2.id, 'ALT-' || p.sku, s2.lead_time_days, false from (select pp.*, row_number() over (order by pp.sku) rn from public.products pp where pp.organization_id = org) p
  join public.suppliers s2 on s2.organization_id = org and s2.id <> p.default_supplier_id and s2.name = ${sq(SUPPLIERS[0][0])} where p.rn % 2 = 0;
  -- idade do cadastro: os produtos existem há mais de ${OPEN_AGO + 10} dias (para os indicadores de produto parado)
  update public.products set created_at = now() - interval '${OPEN_AGO + 10} days' where organization_id = org;
  -- a partir daqui, as operações usam a sessão do proprietário (claims), exatamente como o app
  perform set_config('request.jwt.claims', '{"sub":"${uid(U.owner)}","aal":"aal2","role":"authenticated"}', true);
end $seed$;
`;

const ops = `
do $ops$
begin
  if not exists (select 1 from public.organizations where id = '${ORG}') or exists (select 1 from public.stock_operations where organization_id = '${ORG}') then return; end if;
  perform set_config('request.jwt.claims', '{"sub":"${uid(U.owner)}","aal":"aal2","role":"authenticated"}', true);
${sql.map((s) => `  perform ${s};`).join('\n')}
  perform public.inv_run_routines('${ORG}');
end $ops$;
`;

const header = `-- GERADO por scripts/gen-seed.mjs — NÃO edite à mão. Dados fictícios de demonstração (local). Senha dos usuários @demo.exemplo: DemoLocal#2026.\n`;
mkdirSync(join(root, 'supabase'), { recursive: true });
writeFileSync(join(root, 'supabase', 'seed.sql'), header + helpers + prelude + ops);
const counts = { operations: sql.length, products: products.length };
writeFileSync(join(root, 'supabase', 'seed-plan.json'), JSON.stringify({
  org: ORG, users: { owner: 'dono@demo.exemplo', manager: 'gestor@demo.exemplo', operator: 'operador@demo.exemplo', viewer: 'consulta@demo.exemplo', operatorLoja: 'operador.loja@demo.exemplo' }, password: 'DemoLocal#2026',
  warehouses: WAREHOUSES.map((w) => w[0]), suppliers: SUPPLIERS.map((s) => s[0]), idleSkus: [...IDLE_SKUS],
  checksum: createHash('sha256').update(sql.join('\n')).digest('hex').slice(0, 16), counts,
}, null, 2) + '\n');
console.log(`seed.sql gerado: ${counts.operations} operações sobre ${counts.products} produtos em 3 depósitos.`);
