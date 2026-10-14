import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiSignUp, onboardAndEnrollMfa, uiLogin, uniqueEmail } from './helpers';
import { brl, expectNoServerError, norm } from './inv-helpers';

// Operação de estoque ponta a ponta numa organização NOVA (sem seed), com MFA do proprietário, contra o Supabase real.
test.describe.configure({ mode: 'serial' });

// Uma única sessão (login + MFA uma vez) para toda a suíte serial: evita estourar o limitador de login do app.
let page: Page;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  page = await context.newPage();
});
test.afterAll(async () => { await page.context().close(); });

const email = uniqueEmail('inv');
let saleUrl = '';
let productUrl = '';
let kgUrl = '';

const money = (cents: number) => norm(brl(cents));
const form = (p: Page, button: string | RegExp): Locator => p.locator('form', { has: p.getByRole('button', { name: button }) }).first();
async function text(p: Page) { return norm(await p.locator('main').innerText()); }
/** Abre um painel recolhível (details) pelo texto do resumo, se ainda estiver fechado. */
async function open(p: Page, summary: string | RegExp) {
  const d = p.locator('details', { has: p.locator('summary', { hasText: summary }) }).first();
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('summary').first().click();
}
/** Adiciona um produto ao editor de itens pelo SKU (como faria um leitor USB: texto + Enter). */
async function addItem(scope: Locator, sku: string, qty: string, cost?: string) {
  const search = scope.getByLabel('Adicionar produto');
  await search.fill(sku);
  await search.press('Enter');
  await expect(scope.getByLabel(`Quantidade de ${sku}`)).toBeVisible();
  await scope.getByLabel(`Quantidade de ${sku}`).fill(qty);
  if (cost !== undefined) await scope.getByLabel(`Custo unitário de ${sku} em reais`).fill(cost);
}
/** Valor de um indicador da página do produto («Saldo físico» etc.). */
async function kpi(p: Page, label: string) { return norm(await p.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::p[1]').innerText()); }

test('cria conta, organização e entra com verificação em duas etapas', async () => {
  await apiSignUp(email);
  await uiLogin(page, email);
  await onboardAndEnrollMfa(page, 'Distribuidora Fluxo E2E Ltda');
  await expect(page.getByText('Comece cadastrando o estoque')).toBeVisible();
});

test('depósitos, fornecedor e categoria: cadastro com código único', async () => {
  await page.goto('/depositos');
  await open(page, 'Criar depósito');
  let f = form(page, 'Criar depósito');
  await f.getByLabel('Nome', { exact: true }).fill('Loja Principal');
  await f.getByLabel('Código').fill('LOJA');
  await f.getByRole('button', { name: 'Criar depósito' }).click();
  await expect(page.getByText('Depósito criado.').first()).toBeVisible();
  f = form(page, 'Criar depósito');
  await f.getByLabel('Nome', { exact: true }).fill('Centro de Distribuição');
  await f.getByLabel('Código').fill('CD');
  await f.getByRole('button', { name: 'Criar depósito' }).click();
  await expect(page.getByRole('cell', { name: 'CD', exact: true })).toBeVisible();
  // código repetido é recusado
  f = form(page, 'Criar depósito');
  await f.getByLabel('Nome', { exact: true }).fill('Outro');
  await f.getByLabel('Código').fill('loja');
  await f.getByRole('button', { name: 'Criar depósito' }).click();
  await expect(page.getByText('Já existe um depósito com este nome ou código.')).toBeVisible();

  await page.goto('/fornecedores');
  await open(page, 'Cadastrar fornecedor');
  f = form(page, 'Cadastrar fornecedor');
  await f.getByLabel('Nome', { exact: true }).fill('Fornecedor E2E');
  await f.getByLabel('E-mail').fill('compras@fornecedor.exemplo');
  await f.getByRole('button', { name: 'Cadastrar fornecedor' }).click();
  await expect(page.getByText('Fornecedor cadastrado.').first()).toBeVisible();

  await page.goto('/categorias');
  await open(page, 'Nova categoria');
  f = form(page, 'Criar categoria');
  await f.getByLabel('Nome', { exact: true }).fill('Eletrônicos');
  await f.getByRole('button', { name: 'Criar categoria' }).click();
  await expect(page.getByText('Categoria criada.').first()).toBeVisible();
});

test('produtos: SKU e código de barras únicos, EAN com dígito verificador e unidade fracionária', async () => {
  await page.goto('/produtos');
  await open(page, 'Cadastrar produto');
  let f = form(page, 'Cadastrar produto');
  await f.getByLabel('SKU').fill('E2E-001');
  await f.getByLabel('Nome', { exact: true }).fill('Cabo teste');
  await f.getByLabel('Unidade de medida').selectOption({ label: 'Unidade (un)' });
  await f.getByLabel('Categoria').selectOption({ label: 'Eletrônicos' });
  await f.getByLabel('Código de barras (opcional)').fill('7891000100104'); // dígito verificador errado
  await f.getByRole('button', { name: 'Cadastrar produto' }).click();
  await expect(page.getByText(/Número inválido: use 8, 12 ou 13 dígitos/)).toBeVisible();
  await f.getByLabel('Código de barras (opcional)').fill('7891000100103');
  await f.getByRole('button', { name: 'Cadastrar produto' }).click();
  await page.waitForURL(/\/produtos\/[0-9a-f-]{36}$/);
  productUrl = page.url();
  await expect(page.getByRole('heading', { name: 'E2E-001 — Cabo teste', level: 1 })).toBeVisible();

  // produto em quilo (3 casas)
  await page.goto('/produtos');
  await open(page, 'Cadastrar produto');
  f = form(page, 'Cadastrar produto');
  await f.getByLabel('SKU').fill('E2E-KG');
  await f.getByLabel('Nome', { exact: true }).fill('Arroz a granel');
  await f.getByLabel('Unidade de medida').selectOption({ label: 'Quilograma (kg)' });
  await f.getByLabel('Código de barras (opcional)').fill('INT-0001');
  await f.getByRole('button', { name: 'Cadastrar produto' }).click();
  await page.waitForURL(/\/produtos\/[0-9a-f-]{36}$/);
  kgUrl = page.url();

  // SKU repetido (ignora maiúsculas) e código repetido
  await page.goto('/produtos');
  await open(page, 'Cadastrar produto');
  f = form(page, 'Cadastrar produto');
  await f.getByLabel('SKU').fill('e2e-001');
  await f.getByLabel('Nome', { exact: true }).fill('Repetido');
  await f.getByLabel('Unidade de medida').selectOption({ label: 'Unidade (un)' });
  await f.getByRole('button', { name: 'Cadastrar produto' }).click();
  await expect(page.getByText('Já existe um produto com este SKU ou código de barras.')).toBeVisible();
});

test('entradas: custo médio ponderado (10 a R$ 20,00 + 10 a R$ 30,00 = 20 un, R$ 500,00, média R$ 25,00)', async () => {
  await page.goto('/entradas');
  await open(page, 'Registrar entrada');
  let f = form(page, 'Registrar entrada');
  await f.getByLabel('Depósito de destino').selectOption({ label: 'LOJA · Loja Principal' });
  await f.getByLabel('Fornecedor (opcional)').selectOption({ label: 'Fornecedor E2E' });
  await addItem(f, 'E2E-001', '10', '20,00');
  await f.getByRole('button', { name: 'Registrar entrada' }).click();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Entrada nº 1', level: 1 })).toBeVisible();
  expect(await text(page)).toContain(money(20000));

  await page.goto('/entradas');
  await open(page, 'Registrar entrada');
  f = form(page, 'Registrar entrada');
  await f.getByLabel('Depósito de destino').selectOption({ label: 'LOJA · Loja Principal' });
  await addItem(f, 'E2E-001', '10', '30,00');
  await f.getByRole('button', { name: 'Registrar entrada' }).click();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);

  await page.goto(productUrl);
  await expect(async () => {
    expect(await kpi(page, 'Saldo físico')).toBe('20 un');
    expect(await kpi(page, 'Custo médio')).toBe(money(2500));
    expect(await kpi(page, 'Valor gerencial')).toBe(money(50000));
  }).toPass({ timeout: 10_000 });

  // compra sem custo é recusada; fração em unidade inteira também
  await page.goto('/entradas');
  await open(page, 'Registrar entrada');
  f = form(page, 'Registrar entrada');
  await f.getByLabel('Depósito de destino').selectOption({ label: 'LOJA · Loja Principal' });
  await addItem(f, 'E2E-001', '1,5', '10,00');
  await expect(page.getByText('Número inteiro.')).toBeVisible();
  await f.getByRole('button', { name: 'Registrar entrada' }).click();
  await expect(page.getByText(/quantidade inválida — esta unidade só aceita números inteiros/i)).toBeVisible();
});

test('saídas: baixa o saldo pelo custo médio, recusa saldo insuficiente e o duplo clique não duplica', async () => {
  await page.goto('/saidas');
  await open(page, 'Registrar saída');
  const f = form(page, 'Registrar saída');
  await f.getByLabel('Depósito de origem').selectOption({ label: 'LOJA · Loja Principal' });
  await addItem(f, 'E2E-001', '21');
  await expect(page.getByText('acima do saldo')).toBeVisible();
  await f.getByRole('button', { name: 'Registrar saída' }).click();
  await expect(page.getByText(/saldo insuficiente de «E2E-001» neste depósito: disponível 20, pedido 21/i)).toBeVisible();

  await f.getByLabel('Quantidade de E2E-001').fill('4');
  await f.getByRole('button', { name: 'Registrar saída' }).dblclick();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);
  saleUrl = page.url();
  await expect(page.getByRole('heading', { name: /^Saída nº 3$/, level: 1 })).toBeVisible();
  expect(await text(page)).toContain(money(-10000)); // 4 un × média R$ 25,00 = R$ 100,00

  await page.goto(productUrl);
  await expect(async () => {
    expect(await kpi(page, 'Saldo físico')).toBe('16 un');
    expect(await kpi(page, 'Valor gerencial')).toBe(money(40000));
  }).toPass({ timeout: 10_000 });
  // uma única saída (nº 3): nada de nº 4
  await page.goto('/saidas');
  expect(await text(page)).not.toMatch(/\b4\s+\d{2}\/\d{2}\/\d{4}.*Saída/);
  await expect(page.getByRole('row').filter({ hasText: 'Venda' })).toHaveCount(1);
});

test('transferência: conserva quantidade e valor; origem e destino diferentes', async () => {
  await page.goto('/transferencias');
  await open(page, 'Registrar transferência');
  const f = form(page, 'Registrar transferência');
  await f.getByLabel('Depósito de origem').selectOption({ label: 'LOJA · Loja Principal' });
  await expect(f.getByLabel('Depósito de destino').locator('option', { hasText: 'LOJA' })).toHaveCount(0);
  await f.getByLabel('Depósito de destino').selectOption({ label: 'CD · Centro de Distribuição' });
  await addItem(f, 'E2E-001', '6');
  await f.getByRole('button', { name: 'Registrar transferência' }).click();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);
  await page.goto(productUrl);
  await expect(async () => {
    expect(await kpi(page, 'Saldo físico')).toBe('16 un');
    expect(await kpi(page, 'Valor gerencial')).toBe(money(40000));
  }).toPass({ timeout: 10_000 });
  const t = await text(page);
  expect(t).toMatch(/LOJA · Loja Principal 10 un/);
  expect(t).toMatch(/CD · Centro de Distribuição 6 un/);
});

test('quilo: até 3 casas decimais, entrada de 10,5 kg a R$ 8,00 e saída de 2,5 kg', async () => {
  await page.goto('/entradas');
  await open(page, 'Registrar entrada');
  let f = form(page, 'Registrar entrada');
  await f.getByLabel('Depósito de destino').selectOption({ label: 'CD · Centro de Distribuição' });
  await addItem(f, 'E2E-KG', '1,2345', '8,00');
  await expect(page.getByText('Até 3 casas.')).toBeVisible();
  await f.getByLabel('Quantidade de E2E-KG').fill('10,5');
  await f.getByRole('button', { name: 'Registrar entrada' }).click();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);
  await page.goto('/saidas');
  await open(page, 'Registrar saída');
  f = form(page, 'Registrar saída');
  await f.getByLabel('Depósito de origem').selectOption({ label: 'CD · Centro de Distribuição' });
  await addItem(f, 'E2E-KG', '2,5');
  await f.getByRole('button', { name: 'Registrar saída' }).click();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);
  await page.goto(kgUrl);
  await expect(async () => {
    expect(await kpi(page, 'Saldo físico')).toBe('8 kg');
    expect(await kpi(page, 'Valor gerencial')).toBe(money(6400)); // 8400 − 8400 × 2,5 ÷ 10,5
  }).toPass({ timeout: 10_000 });
});

test('ajuste exige justificativa; estorno devolve o saldo e o valor originais, uma vez só', async () => {
  await page.goto('/ajustes');
  await open(page, 'Registrar ajuste');
  const f = form(page, 'Registrar ajuste');
  await f.getByLabel('Depósito', { exact: true }).selectOption({ label: 'LOJA · Loja Principal' });
  await addItem(f, 'E2E-001', '1');
  await f.getByRole('button', { name: 'Registrar ajuste' }).click();
  await expect(page.getByText('Justificativa: mínimo de 5 caracteres.')).toBeVisible();
  await f.getByLabel('Justificativa (obrigatória)').fill('Quebra na prateleira');
  await f.getByRole('button', { name: 'Registrar ajuste' }).click();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);

  // estorna a venda de 4 un
  await page.goto(saleUrl);
  await open(page, 'Estornar esta operação');
  const r = form(page, 'Estornar operação');
  await r.getByLabel('Motivo do estorno').fill('Cliente cancelou o pedido');
  await r.getByRole('button', { name: 'Estornar operação' }).click();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Este é um estorno da')).toBeVisible();
  await page.goto(saleUrl);
  await expect(page.getByText(/Esta operação foi estornada em/)).toBeVisible();
  await expect(page.getByText('Estornar esta operação')).toHaveCount(0);
  await page.goto(productUrl);
  await expect(async () => {
    expect(await kpi(page, 'Saldo físico')).toBe('19 un'); // 16 + 4 do estorno − 1 do ajuste
  }).toPass({ timeout: 10_000 });
  await expectNoServerError(page, 'produto');
});

test('inventário: congela o esperado; saldo que muda durante a contagem bloqueia a aprovação até recontar', async () => {
  await page.goto('/inventarios');
  await open(page, 'Iniciar inventário');
  const f = form(page, 'Iniciar inventário');
  await f.getByLabel('Depósito', { exact: true }).selectOption({ label: 'LOJA · Loja Principal' });
  await f.getByLabel('Título').fill('Contagem E2E da loja');
  await f.getByRole('button', { name: 'Iniciar inventário' }).click();
  await page.waitForURL(/\/inventarios\/[0-9a-f-]{36}$/);
  const countUrl = page.url();
  await expect(page.getByRole('heading', { name: 'Contagem E2E da loja', level: 1 })).toBeVisible();
  await expect(page.getByRole('row', { name: /E2E-001/ })).toContainText('13 un');

  await page.getByLabel('Quantidade contada').fill('12');
  await page.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('Contagem registrada.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText('Enviado para aprovação.').first()).toBeVisible();

  await page.goto('/saidas');
  await open(page, 'Registrar saída');
  const s = form(page, 'Registrar saída');
  await s.getByLabel('Depósito de origem').selectOption({ label: 'LOJA · Loja Principal' });
  await addItem(s, 'E2E-001', '1');
  await s.getByRole('button', { name: 'Registrar saída' }).click();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);

  await page.goto(countUrl);
  await expect(page.getByText('Saldo mudou: recontar')).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar e gerar ajustes' }).click();
  await expect(page.getByText(/saldo alterado depois do início da contagem/i)).toBeVisible();

  await page.getByRole('button', { name: 'Reabrir itens com saldo alterado' }).click();
  await expect(page.getByText('Inventário reaberto').first()).toBeVisible();
  await page.goto(countUrl);
  await expect(page.getByRole('row', { name: /E2E-001/ })).toContainText('12 un');
  await page.getByLabel('Quantidade contada').fill('11');
  await page.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('Contagem registrada.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText('Enviado para aprovação.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar e gerar ajustes' }).click();
  await expect(page.getByText('Inventário aprovado').first()).toBeVisible();
  await page.goto('/ajustes');
  expect(await text(page)).toContain('Ajuste de inventário');
});

test('reposição: parâmetros do produto geram sugestões; analisar não cria pedido', async () => {
  await page.goto(productUrl);
  await open(page, 'Editar produto');
  const f = form(page, 'Salvar produto');
  await f.getByLabel('Estoque mínimo').fill('5');
  await f.getByLabel('Ponto de reposição').fill('10');
  await f.getByLabel('Estoque-alvo').fill('50');
  await f.getByRole('button', { name: 'Salvar produto' }).click();
  await expect(page.getByText('Produto atualizado.').first()).toBeVisible();
  await f.getByLabel('Estoque mínimo').fill('20');
  await f.getByRole('button', { name: 'Salvar produto' }).click();
  await expect(page.getByText('O ponto de reposição deve ser maior ou igual ao mínimo.')).toBeVisible();

  await page.goto('/reposicao');
  await page.getByRole('button', { name: 'Atualizar sugestões e avisos agora' }).click();
  await expect(page.getByText(/Rotinas executadas/).first()).toBeVisible();
  await page.goto('/reposicao');
  const row = page.getByRole('row', { name: /E2E-001/ });
  await expect(row).toContainText('Atenção');
  await row.getByRole('button', { name: 'Marcar como analisada' }).click();
  await expect(page.getByText('Sugestão marcada como analisada').first()).toBeVisible();
});

test('importação CSV: prévia com erros e repetidos, confirmação e arquivo repetido', async () => {
  const csv = ['sku;nome;unidade;categoria', 'IMP-001;Produto importado;un;Eletrônicos', 'IMP-002;Quilo importado;kg;', 'E2E-001;Repetido;un;', 'IMP-003;Sem unidade;xx;'].join('\n');
  const upload = async (name: string, content: string) => {
    await page.goto('/importacoes');
    const g = page.locator('form').filter({ has: page.getByLabel('O que importar') }).first();
    await g.getByLabel(/Arquivo CSV/).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content, 'utf8') });
    await expect(page.getByText('Mapeamento das colunas')).toBeVisible();
    await g.getByRole('button', { name: 'Gerar prévia da importação' }).click();
  };
  await upload('produtos.csv', csv);
  await page.waitForURL(/\/importacoes\/[0-9a-f-]{36}$/);
  const t = await text(page);
  expect(t).toMatch(/Válidas\s*2/);
  expect(t).toMatch(/Com erro\s*1/);
  await page.getByRole('button', { name: /Confirmar importação de 2 linha/ }).click();
  await expect(page.getByText(/Importação concluída/).first()).toBeVisible();
  await page.goto('/produtos?q=IMP-');
  await expect(page.getByRole('link', { name: 'IMP-001' })).toBeVisible();
  await upload('produtos.csv', csv);
  await expect(page.getByText(/já foi importado/)).toBeVisible();
});

test('etiqueta: o código de barras do cadastro é desenhado', async () => {
  const id = productUrl.split('/').pop();
  await page.goto(`/etiquetas?p=${id}`);
  await expect(page.getByRole('img', { name: /Código de barras 7891000100103/ })).toBeVisible();
});

test('exportação CSV: separador ;, BOM e neutralização de fórmula', async () => {
  await page.goto('/produtos');
  await open(page, 'Cadastrar produto');
  const f = form(page, 'Cadastrar produto');
  await f.getByLabel('SKU').fill('E2E-INJ');
  await f.getByLabel('Nome', { exact: true }).fill('=HYPERLINK("http://exemplo.invalido";"clique")');
  await f.getByLabel('Unidade de medida').selectOption({ label: 'Unidade (un)' });
  await f.getByRole('button', { name: 'Cadastrar produto' }).click();
  await page.waitForURL(/\/produtos\/[0-9a-f-]{36}$/);
  await page.goto('/entradas');
  await open(page, 'Registrar entrada');
  const e = form(page, 'Registrar entrada');
  await e.getByLabel('Depósito de destino').selectOption({ label: 'LOJA · Loja Principal' });
  await addItem(e, 'E2E-INJ', '2', '1,00');
  await e.getByRole('button', { name: 'Registrar entrada' }).click();
  await page.waitForURL(/\/movimentacoes\/[0-9a-f-]{36}$/);

  const res = await page.request.get('/api/export/saldo-deposito');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  const body = await res.text();
  expect(body.charCodeAt(0)).toBe(0xfeff);
  expect(body).toContain("'=HYPERLINK");
  expect(body).not.toMatch(/;=HYPERLINK/);
  expect(body).toContain('E2E-001');
});

test('anexos: imagem real entra; arquivo disfarçado e PDF ativo são recusados', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.goto(productUrl);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Imagem e etiqueta' }) });
  const send = async (name: string, mimeType: string, buffer: Buffer) => {
    await panel.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
    await panel.getByRole('button', { name: 'Enviar' }).click();
  };
  await send('foto.png', 'image/png', Buffer.from('MZ\x90\x00 executavel disfarcado'));
  await expect(panel.getByText(/Formato não aceito|não corresponde/)).toBeVisible();
  await send('foto.png', 'image/png', png);
  await expect(panel.getByText('Arquivo anexado.')).toBeVisible();

  await page.goto(saleUrl);
  const doc = page.locator('section', { has: page.getByRole('heading', { name: 'Documentos anexados' }) });
  await doc.locator('input[type=file]').setInputFiles({ name: 'ativo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << /JavaScript (app.alert(1)) >> endobj\n%%EOF') });
  await doc.getByRole('button', { name: 'Enviar' }).click();
  await expect(doc.getByText(/conteúdo ativo/)).toBeVisible();
});
