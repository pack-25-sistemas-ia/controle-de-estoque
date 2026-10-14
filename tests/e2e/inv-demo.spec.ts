import { expect, test } from '@playwright/test';
import { DEMO, apiJson, demoLogin, demoToken, expectNoServerError, norm } from './inv-helpers';
import { SUPABASE_URL } from './helpers';

// Dados de demonstração (supabase/seed.sql). Pré-requisito: `supabase db reset` recém-executado e o app em produção na porta do site_url.
test.describe.configure({ mode: 'serial' });

const PAGES = [
  ['/dashboard', 'Painel de estoque'], ['/produtos', 'Produtos'], ['/saldos', 'Saldos por produto e depósito'], ['/entradas', 'Entradas de estoque'], ['/saidas', 'Saídas de estoque'],
  ['/transferencias', 'Transferências entre depósitos'], ['/ajustes', 'Ajustes de estoque'], ['/movimentacoes', 'Histórico de movimentações'], ['/inventarios', 'Inventário físico'],
  ['/reposicao', 'Reposição de estoque'], ['/etiquetas', 'Etiquetas de produtos'], ['/importacoes', 'Importações (CSV)'], ['/relatorios', 'Relatórios'], ['/categorias', 'Categorias de produtos'],
  ['/fornecedores', 'Fornecedores'], ['/depositos', 'Depósitos'], ['/notificacoes', 'Avisos'], ['/configuracoes', 'Configurações de estoque'],
] as const;

test('gestor de estoque: todas as telas abrem com dados reais e sem erro', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  for (const [path, heading] of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { name: heading, level: 1 }).first(), path).toBeVisible();
    await expectNoServerError(page, path);
  }
  // relatórios: os 18 abrem
  await page.goto('/relatorios');
  const links = await page.locator('a[href^="/relatorios?r="]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!));
  expect(links).toHaveLength(18);
  for (const href of links) {
    const res = await page.goto(href);
    expect(res?.status(), href).toBe(200);
    await expectNoServerError(page, href);
    await expect(page.getByRole('link', { name: 'Exportar CSV' }), href).toBeVisible();
  }
});

test('painel = banco: valor, SKUs e saldo conferem com recálculo independente a partir do livro', async ({ page }) => {
  const token = await demoToken(DEMO.manager);
  // Recalcula só com os FATOS (movimentos) e compara com o estado de custo e o saldo materializado.
  const moves = await apiJson<Array<{ product_id: string; warehouse_id: string; quantity_delta: number; value_delta_cents: number }>>(token, 'stock_movements?select=product_id,warehouse_id,quantity_delta,value_delta_cents&limit=5000');
  expect(moves.length).toBeGreaterThan(500);
  const balances = await apiJson<Array<{ product_id: string; warehouse_id: string; quantity_on_hand: number }>>(token, 'inventory_balances?select=product_id,warehouse_id,quantity_on_hand&limit=5000');
  const sum = new Map<string, number>();
  for (const m of moves) sum.set(`${m.product_id}|${m.warehouse_id}`, Math.round(((sum.get(`${m.product_id}|${m.warehouse_id}`) ?? 0) + Number(m.quantity_delta)) * 1000) / 1000);
  for (const b of balances) expect(Number(b.quantity_on_hand), `saldo ${b.product_id}`).toBeCloseTo(sum.get(`${b.product_id}|${b.warehouse_id}`) ?? 0, 3);
  expect(balances.every((b) => Number(b.quantity_on_hand) >= 0), 'nenhum saldo negativo').toBe(true);
  const totalValue = moves.reduce((s, m) => s + Number(m.value_delta_cents), 0);
  const cost = await apiJson<Array<{ total_value_cents: number }>>(token, 'inventory_cost_state?select=total_value_cents&limit=5000');
  expect(cost.reduce((s, c) => s + Number(c.total_value_cents), 0)).toBe(totalValue);

  await demoLogin(page, DEMO.manager);
  await page.goto('/dashboard?period=90d');
  const text = norm(await page.locator('main').innerText());
  const brl = (c: number) => norm(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100));
  expect(text).toContain(brl(totalValue));
  // o painel mostra o mesmo número de SKUs ativos que o cadastro
  const prods = await apiJson<Array<{ id: string }>>(token, 'products?select=id&status=eq.active&archived_at=is.null&limit=5000');
  await expect(page.getByText('Produtos ativos', { exact: true }).locator('xpath=..').getByText(String(prods.length), { exact: true }).first()).toBeVisible();
});

test('dados de demonstração: histórico longo, estorno, inventário e reposição existem', async () => {
  const token = await demoToken(DEMO.manager);
  const ops = await apiJson<Array<{ operation_type: string; status: string }>>(token, 'stock_operations?select=operation_type,status&limit=5000');
  expect(ops.length).toBeGreaterThan(200);
  for (const t of ['opening', 'entry', 'issue', 'transfer', 'adjustment', 'count_adjustment', 'reversal']) expect(ops.some((o) => o.operation_type === t), `há operação ${t}`).toBe(true);
  expect(ops.some((o) => o.status === 'reversed')).toBe(true);
  const counts = await apiJson<Array<{ status: string }>>(token, 'physical_counts?select=status');
  expect(counts.map((c) => c.status).sort()).toEqual(['awaiting_approval', 'completed', 'counting']);
  const sug = await apiJson<Array<{ id: string }>>(token, 'replenishment_suggestions?select=id&status=eq.pending');
  expect(sug.length).toBeGreaterThan(0);
  // a visão de saldos fecha com o valor do custo (distribuição por maior resto)
  const view = await apiJson<Array<{ value_cents: number }>>(token, 'inv_stock_view?select=value_cents&limit=5000');
  const cost = await apiJson<Array<{ total_value_cents: number }>>(token, 'inventory_cost_state?select=total_value_cents&limit=5000');
  expect(view.reduce((s, v) => s + Number(v.value_cents), 0)).toBe(cost.reduce((s, c) => s + Number(c.total_value_cents), 0));
});

test('operador: cadastra, movimenta e importa, mas não ajusta, não estorna, não exporta e não vê configurações de gestão', async ({ page }) => {
  await demoLogin(page, DEMO.operator);
  await page.goto('/entradas');
  await expect(page.getByRole('button', { name: 'Registrar entrada' })).toBeVisible();
  await page.goto('/ajustes');
  await expect(page.getByText('Ajustes de saldo são feitos pelo gestor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar ajuste' })).toHaveCount(0);
  await page.goto('/relatorios?r=saldo-produto');
  await expect(page.getByRole('link', { name: 'Exportar CSV' })).toHaveCount(0);
  const res = await page.request.get('/api/export/saldo-produto');
  expect(res.status()).toBe(403);
  await page.goto('/categorias');
  await expect(page.getByRole('button', { name: 'Criar categoria' })).toHaveCount(0);
  // o operador restrito só vê/usa a loja
  const token = await demoToken(DEMO.operatorLoja);
  const wh = await apiJson<Array<{ code: string }>>(token, 'warehouses?select=code');
  expect(wh.length).toBe(3); // enxerga os depósitos (consulta), mas só opera na loja (testado em inv-security)
});

test('consulta: lê tudo, não altera nada', async ({ page }) => {
  await demoLogin(page, DEMO.viewer);
  for (const [path] of PAGES.slice(0, 8)) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
  }
  await page.goto('/entradas');
  await expect(page.getByRole('button', { name: 'Registrar entrada' })).toHaveCount(0);
  await page.goto('/produtos');
  await expect(page.getByText('Cadastrar produto')).toHaveCount(0);
  const token = await demoToken(DEMO.viewer);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/inv_post_issue`, { method: 'POST', headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({}) });
  expect(res.status).toBeGreaterThanOrEqual(400);
});

test('API anônima não lê nada e o Storage de arquivos é privado', async () => {
  const anon = process.env.E2E_SUPABASE_ANON_KEY ?? '';
  for (const t of ['products', 'stock_movements', 'inventory_balances', 'inv_stock_view', 'attachments']) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: anon } });
    expect([401, 403], t).toContain(res.status);
  }
  const bucket = await fetch(`${SUPABASE_URL}/storage/v1/object/public/inv-files/qualquer.png`);
  expect([400, 404]).toContain(bucket.status);
});
