import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { SUPABASE_URL, ANON_KEY, apiAal2Token, apiLogin, apiSignUp, onboardAndEnrollMfa, uiLogin, uniqueEmail } from './helpers';
import { DEMO, api, apiJson, demoToken } from './inv-helpers';

// Cenários de segurança (§29) contra o Supabase real: empresa A (dados de demonstração) × empresa B (criada aqui, com MFA).
// Pré-requisito: `supabase db reset` recente + app em produção. Escritas feitas aqui: entradas pequenas na LOJA (operador restrito e gestor).
test.describe.configure({ mode: 'serial' });

let managerToken = '';
let operatorToken = '';
let viewerToken = '';
let tokenB = '';
let orgA = '';
let whLoja = '';
let whCd = '';
let productA = '';
let opA = '';
let orgB = '';

const rpc = (token: string, fn: string, body: Record<string, unknown>) => api(token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
const item = (product: string, quantity: number, unit_cost?: number) => [{ product_id: product, quantity, ...(unit_cost === undefined ? {} : { unit_cost }) }];
const entry = (token: string, org: string, wh: string, items: unknown, key: string) =>
  rpc(token, 'inv_post_entry', { p_org: org, p_warehouse: wh, p_reason: 'purchase', p_items: items, p_supplier: null, p_external_ref: null, p_notes: null, p_at: null, p_key: key });

/** Negação de verdade: erro do banco/RLS, não «função inexistente» (PGRST202) nem requisição malformada por engano. */
async function expectDenied(res: Response, label: string) {
  const body = await res.text();
  expect(res.status, `${label}: deveria ser negado (${body.slice(0, 120)})`).toBeGreaterThanOrEqual(400);
  expect(body, `${label}: a função existe e a negação veio do banco`).not.toMatch(/PGRST202|Could not find the function/);
}
/** Escrita que não pode surtir efeito: ou erro, ou RLS filtrou tudo (lista vazia). */
async function expectNoEffect(res: Response, label: string) {
  if (res.status >= 400) return;
  expect(await res.json(), `${label}: nada deve ser afetado`).toEqual([]);
}

test('preparação: sessões da empresa A (gestor, operador restrito, consulta) e da empresa B (com MFA)', async ({ browser }) => {
  managerToken = await demoToken(DEMO.manager);
  operatorToken = await demoToken(DEMO.operatorLoja);
  viewerToken = await demoToken(DEMO.viewer);
  const whs = await apiJson<Array<{ id: string; code: string; organization_id: string }>>(managerToken, 'warehouses?select=id,code,organization_id');
  orgA = whs[0]!.organization_id;
  whLoja = whs.find((w) => w.code === 'LOJA')!.id;
  whCd = whs.find((w) => w.code === 'CD')!.id;
  productA = (await apiJson<Array<{ id: string }>>(managerToken, 'products?select=id&status=eq.active&limit=1'))[0]!.id;
  opA = (await apiJson<Array<{ id: string }>>(managerToken, 'stock_operations?select=id&operation_type=eq.issue&status=eq.confirmed&limit=1'))[0]!.id;

  const email = uniqueEmail('invB');
  await apiSignUp(email);
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  const page = await ctx.newPage();
  await uiLogin(page, email);
  const secret = await onboardAndEnrollMfa(page, 'Empresa B Segurança Ltda');
  await ctx.close();
  tokenB = await apiAal2Token(await apiLogin(email), secret);
  orgB = (await apiJson<Array<{ organization_id: string }>>(tokenB, 'organization_members?select=organization_id'))[0]!.organization_id;
  expect(orgB).not.toBe(orgA);
});

test('1–3 · isolamento entre empresas: B não lê nem lista nada de A', async () => {
  for (const t of ['products', 'warehouses', 'stock_operations', 'stock_movements', 'inventory_balances', 'inventory_cost_state', 'physical_counts', 'attachments', 'import_jobs', 'replenishment_suggestions', 'inv_notifications']) {
    const res = await api(tokenB, `${t}?select=*&limit=5`);
    expect(res.status, `B lendo ${t}`).toBe(200); // a tabela existe e responde; RLS devolve vazio
    expect(await res.json(), `B lendo ${t}`).toEqual([]);
  }
  expect(await (await api(tokenB, `products?select=id&organization_id=eq.${orgA}`)).json()).toEqual([]);
  expect(await (await api(tokenB, `stock_operations?select=id&id=eq.${opA}`)).json()).toEqual([]);
  await expectDenied(await rpc(tokenB, 'inv_dashboard_kpis', { p_org: orgA, p_from: '2026-01-01', p_to: '2026-12-31' }), 'B lendo painel de A');
  const own = await rpc(tokenB, 'inv_dashboard_kpis', { p_org: orgB, p_from: '2026-01-01', p_to: '2026-12-31' });
  expect(own.status, 'controle: B lê o próprio painel').toBe(200);
});

test('4–6 · B não opera em A: entrada, estorno e IDs adulterados são recusados e nada muda', async () => {
  const before = (await apiJson<Array<{ id: string }>>(managerToken, 'stock_movements?select=id&limit=5000')).length;
  await expectDenied(await entry(tokenB, orgA, whLoja, item(productA, 1, 1), `sec-b-${randomUUID()}`), 'B dando entrada em A');
  await expectDenied(await rpc(tokenB, 'inv_reverse_operation', { p_operation: opA, p_reason: 'tentativa de B', p_key: `sec-rv-${randomUUID()}` }), 'B estornando operação de A');
  await expectDenied(await entry(tokenB, orgB, whLoja, item(productA, 1, 1), `sec-mix-${randomUUID()}`), 'B com depósito e produto de A');
  const after = (await apiJson<Array<{ id: string }>>(managerToken, 'stock_movements?select=id&limit=5000')).length;
  expect(after).toBe(before);
});

test('7 · consulta (viewer) lê mas não escreve: RPC e tabelas negadas', async () => {
  await expectDenied(await entry(viewerToken, orgA, whLoja, item(productA, 1, 1), `sec-v-${randomUUID()}`), 'consulta dando entrada');
  await expectDenied(await api(viewerToken, 'products', { method: 'POST', body: JSON.stringify({ organization_id: orgA, sku: 'HACK-1', name: 'x' }) }), 'consulta inserindo produto direto');
  expect((await api(viewerToken, 'products?select=id&limit=1')).status).toBe(200);
});

test('8–9 · operador restrito: só movimenta a LOJA; CD, ajuste e estorno são negados', async () => {
  const denied = await entry(operatorToken, orgA, whCd, item(productA, 1, 1), `sec-cd-${randomUUID()}`);
  await expectDenied(denied.clone(), 'operador restrito no CD');
  expect(await denied.text()).toMatch(/dep[óo]sito|permiss|autoriz|acesso/i);
  const ok = await entry(operatorToken, orgA, whLoja, item(productA, 1, 1), `sec-loja-${randomUUID()}`);
  expect(ok.status, await ok.clone().text()).toBeLessThan(300);
  await expectDenied(await rpc(operatorToken, 'inv_post_adjustment', { p_org: orgA, p_warehouse: whLoja, p_direction: 'in', p_reason: 'other_entry', p_justification: 'tentativa do operador', p_items: item(productA, 1, 1), p_at: null, p_key: `sec-adj-${randomUUID()}` }), 'operador ajustando');
  await expectDenied(await rpc(operatorToken, 'inv_reverse_operation', { p_operation: opA, p_reason: 'tentativa do operador', p_key: `sec-rv2-${randomUUID()}` }), 'operador estornando');
});

test('10–12 · histórico imutável e saldo só pelo motor: escrita direta negada até para o gestor', async () => {
  const mv = (await apiJson<Array<{ id: string; quantity_delta: number }>>(managerToken, 'stock_movements?select=id,quantity_delta&limit=1'))[0]!;
  await expectNoEffect(await api(managerToken, `stock_movements?id=eq.${mv.id}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ quantity_delta: 999 }) }), 'update movimento');
  await expectNoEffect(await api(managerToken, `stock_movements?id=eq.${mv.id}`, { method: 'DELETE', headers: { prefer: 'return=representation' } }), 'delete movimento');
  await expectNoEffect(await api(managerToken, 'inventory_balances?quantity_on_hand=gte.0', { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ quantity_on_hand: 99999 }) }), 'update saldo');
  await expectNoEffect(await api(managerToken, 'inventory_cost_state?total_value_cents=gte.0', { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ total_value_cents: 1 }) }), 'update custo');
  const ins = await api(managerToken, 'stock_movements', { method: 'POST', body: JSON.stringify({ organization_id: orgA, product_id: productA, warehouse_id: whLoja, quantity_delta: 100 }) });
  expect(ins.status).toBeGreaterThanOrEqual(400);
  const still = await apiJson<Array<{ quantity_delta: number }>>(managerToken, `stock_movements?select=quantity_delta&id=eq.${mv.id}`);
  expect(Number(still[0]!.quantity_delta)).toBe(Number(mv.quantity_delta));
});

test('13–14 · requisição duplicada devolve a mesma operação; mesma chave com outro conteúdo é recusada', async () => {
  const key = `sec-idem-${randomUUID()}`;
  const a = await entry(managerToken, orgA, whLoja, item(productA, 2, 3), key);
  expect(a.status, await a.clone().text()).toBeLessThan(300);
  const idA = await a.json();
  const b = await entry(managerToken, orgA, whLoja, item(productA, 2, 3), key);
  expect(b.status).toBeLessThan(300);
  expect(await b.json()).toBe(idA);
  await expectDenied(await entry(managerToken, orgA, whLoja, item(productA, 5, 3), key), 'mesma chave, outro conteúdo');
  expect(await apiJson<Array<{ id: string }>>(managerToken, `stock_operations?select=id&id=eq.${idA}`)).toHaveLength(1);
});

test('15 · estoque negativo e quantidades inválidas são recusados no banco, não só na tela', async () => {
  const huge = await rpc(managerToken, 'inv_post_issue', { p_org: orgA, p_warehouse: whLoja, p_reason: 'sale', p_items: item(productA, 99999999), p_external_ref: null, p_notes: null, p_at: null, p_key: `sec-neg-${randomUUID()}` });
  await expectDenied(huge.clone(), 'saída acima do saldo');
  expect(await huge.text()).toMatch(/saldo insuficiente/i);
  for (const q of [0, -5]) await expectDenied(await entry(managerToken, orgA, whLoja, item(productA, q, 1), `sec-q-${randomUUID()}`), `quantidade ${q}`);
});

test('16 · arquivos: sem sessão não baixa; B não lê o bucket de A; ID inexistente não vaza', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  const page = await ctx.newPage();
  const anonRes = await page.request.get(`/api/attachments/${randomUUID()}`, { maxRedirects: 0 });
  expect([302, 307, 401, 403, 404]).toContain(anonRes.status());
  if ([302, 307].includes(anonRes.status())) expect(anonRes.headers().location ?? '').toMatch(/login/);
  await ctx.close();
  const direct = await fetch(`${SUPABASE_URL}/storage/v1/object/inv-files/${orgA}/qualquer.png`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${tokenB}` } });
  expect([400, 401, 403, 404]).toContain(direct.status);
  const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/inv-files`, { method: 'POST', headers: { apikey: ANON_KEY, authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: orgA, limit: 10 }) });
  if (list.status === 200) expect(await list.json()).toEqual([]);
});

test('17 · exportação: só a gestão registra e baixa; a rota exige sessão', async ({ request }) => {
  const anon = await request.get('/api/export/saldo-produto', { maxRedirects: 0 });
  expect([302, 307, 401, 403]).toContain(anon.status());
  await expectDenied(await rpc(operatorToken, 'inv_log_export', { p_org: orgA, p_report: 'saldo_produto', p_rows: 1 }), 'operador registrando exportação');
  expect((await rpc(managerToken, 'inv_log_export', { p_org: orgA, p_report: 'saldo_produto', p_rows: 1 })).status, 'controle: gestor registra').toBeLessThan(300);
});

test('18 · API anônima: sem leitura e sem execução de funções do motor', async () => {
  const args: Record<string, Record<string, unknown>> = {
    inv_post_entry: { p_org: orgA, p_warehouse: whLoja, p_reason: 'purchase', p_items: item(productA, 1, 1), p_supplier: null, p_external_ref: null, p_notes: null, p_at: null, p_key: 'anon-1' },
    inv_post_issue: { p_org: orgA, p_warehouse: whLoja, p_reason: 'sale', p_items: item(productA, 1), p_external_ref: null, p_notes: null, p_at: null, p_key: 'anon-2' },
    inv_reverse_operation: { p_operation: opA, p_reason: 'anônimo tentando', p_key: 'anon-3' },
    inv_run_routines: { p_org: orgA },
    inv_dashboard_kpis: { p_org: orgA, p_from: '2026-01-01', p_to: '2026-12-31' },
  };
  for (const [fn, body] of Object.entries(args)) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await expectDenied(res, `anônimo em ${fn}`);
  }
  const t = await fetch(`${SUPABASE_URL}/rest/v1/stock_movements?select=*&limit=1`, { headers: { apikey: ANON_KEY } });
  expect([401, 403]).toContain(t.status);
});
