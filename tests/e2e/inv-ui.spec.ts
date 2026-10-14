import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, demoLogin } from './inv-helpers';

// Acessibilidade estrutural, responsividade (celular), teclado e tema escuro nas telas com dados de demonstração.
test.describe.configure({ mode: 'serial' });

const PAGES = ['/dashboard', '/produtos', '/saldos', '/entradas', '/saidas', '/transferencias', '/ajustes', '/movimentacoes', '/inventarios', '/reposicao', '/etiquetas', '/importacoes', '/relatorios', '/relatorios?r=curva-abc', '/categorias', '/fornecedores', '/depositos', '/notificacoes', '/configuracoes'];

/** Verificações estruturais (WCAG 2.2 AA em parte): ids únicos, um <main>, um h1, controles com nome e tabelas com legenda. */
async function structural(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const ids = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((e) => ids.set(e.id, (ids.get(e.id) ?? 0) + 1));
    for (const [id, n] of ids) if (n > 1) out.push(`id repetido «${id}» (${n}x)`);
    if (document.querySelectorAll('main').length !== 1) out.push('deve haver exatamente um <main>');
    if (document.querySelectorAll('h1').length !== 1) out.push(`h1: ${document.querySelectorAll('h1').length}`);
    if (!document.documentElement.lang) out.push('<html> sem lang');
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      const i = el as HTMLInputElement;
      if (i.type === 'hidden' || i.type === 'submit') return;
      const named = (i.labels && i.labels.length > 0) || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || i.title;
      if (!named) out.push(`controle sem nome acessível: <${el.tagName.toLowerCase()} name="${i.name}">`);
    });
    document.querySelectorAll('button, a[href]').forEach((el) => {
      const t = (el.textContent ?? '').trim();
      if (!t && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.querySelector('img[alt]')) out.push(`${el.tagName.toLowerCase()} sem texto/nome: ${(el.getAttribute('href') ?? '').slice(0, 40)}`);
    });
    document.querySelectorAll('img').forEach((el) => { if (!el.hasAttribute('alt')) out.push('img sem alt'); });
    document.querySelectorAll('table:not([hidden])').forEach((el) => { if (!el.querySelector('caption')) out.push('tabela sem caption'); });
    document.querySelectorAll('details > summary').forEach((el) => { if (!(el.textContent ?? '').trim()) out.push('summary vazio'); });
    return out;
  });
}

test('acessibilidade estrutural: todas as telas principais', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  for (const path of PAGES) {
    await page.goto(path);
    const problems = await structural(page);
    expect(problems, `${path}: ${problems.join(' | ')}`).toEqual([]);
  }
});

test('teclado: «Ir para o conteúdo» é o primeiro foco; campos têm foco visível', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/produtos');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Ir para o conteúdo' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#conteudo$/);
  await page.goto('/entradas');
  const d = page.locator('details', { has: page.locator('summary', { hasText: 'Registrar entrada' }) }).first();
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('summary').first().click();
  const search = page.getByLabel('Adicionar produto').first();
  await search.focus();
  const outline = await search.evaluate((e) => { const s = getComputedStyle(e); return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}`; });
  expect(outline).not.toBe('none|0px|none');
});

test.describe('celular (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('sem rolagem horizontal da página; tabelas rolam dentro do próprio quadro', async ({ page }) => {
    await demoLogin(page, DEMO.manager);
    for (const path of PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path}: a página rolou ${overflow}px na horizontal`).toBeLessThanOrEqual(1);
    }
  });

  test('operação no celular: menu, formulário de saída e alvo de toque', async ({ page }) => {
    await demoLogin(page, DEMO.operator);
    await page.goto('/dashboard');
    await page.getByText('Menu', { exact: true }).click();
    await page.getByRole('link', { name: 'Saídas' }).first().click();
    await expect(page).toHaveURL(/\/saidas/);
    const d = page.locator('details', { has: page.locator('summary', { hasText: 'Registrar saída' }) }).first();
    if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('summary').first().click();
    const h = await page.getByRole('button', { name: 'Registrar saída' }).first().evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(40);
  });
});

test.describe('tema escuro', () => {
  test.use({ colorScheme: 'dark' });
  test('o painel respeita o tema escuro e o texto continua legível', async ({ page }) => {
    await demoLogin(page, DEMO.manager);
    await page.goto('/dashboard');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const fg = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(bg).not.toBe(fg);
    const lum = (rgb: string) => { const m = rgb.match(/\d+/g)!.map(Number); return (0.2126 * m[0]! + 0.7152 * m[1]! + 0.0722 * m[2]!) / 255; };
    expect(Math.abs(lum(bg) - lum(fg))).toBeGreaterThan(0.5);
  });
});

test('capturas de tela para a documentação (opcional: E2E_SHOTS=1)', async ({ page }) => {
  test.skip(!process.env.E2E_SHOTS, 'defina E2E_SHOTS=1 para gerar docs/screenshots');
  mkdirSync('docs/screenshots', { recursive: true });
  await demoLogin(page, DEMO.manager);
  await page.setViewportSize({ width: 1366, height: 900 });
  for (const [name, path] of [['painel', '/dashboard?period=90d'], ['saldos', '/saldos'], ['movimentacoes', '/movimentacoes'], ['inventario', '/inventarios'], ['reposicao', '/reposicao'], ['relatorios', '/relatorios?r=curva-abc']] as const) {
    await page.goto(path);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: false });
  }
});
