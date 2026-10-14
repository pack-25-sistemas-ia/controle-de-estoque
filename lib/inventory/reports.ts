import 'server-only';
import type { Context } from '@/lib/auth/session';
import { toCsv, type CsvValue } from './csv';
import { categoryTree, loadCategories, loadMovements, loadSuggestions, loadSuppliers, loadWarehouses, productMap, type StockRow } from './data';
import { loadIdle, loadTurnover } from './dashboard';
import { formatDateBR } from './dates';
import type { Filters } from './filters';
import { COST_POLICY_LABELS, COUNT_STATUS_LABELS, MOVE_TYPE_LABELS, REASON_LABELS, STOCK_CLASS_LABELS, SUGGESTION_STATUS_LABELS } from './labels';
import { formatBRL } from './money';
import { formatQty, formatUnitCost } from './qty';

// Relatórios: o mesmo conteúdo aparece na tela e no CSV. Cada célula traz o texto de exibição (d) e o valor do CSV (v).
export type Cell = { d: string; v: CsvValue };
export type Report = { name: string; title: string; description: string; head: string[]; rows: Cell[][]; truncated: boolean };

const txt = (s: string | null | undefined): Cell => ({ d: s ?? '—', v: s ?? '' });
const qty = (n: number | string | null | undefined, unit = ''): Cell => (n === null || n === undefined ? { d: '—', v: '' } : { d: `${formatQty(n)}${unit ? ` ${unit}` : ''}`, v: { num: String(n).replace('.', ',') } });
const brl = (cents: number | null | undefined): Cell => (cents === null || cents === undefined ? { d: '—', v: '' } : { d: formatBRL(cents), v: { num: (cents / 100).toFixed(2).replace('.', ',') } });
const unitCost = (c: number | null | undefined): Cell => (c === null || c === undefined ? { d: '—', v: '' } : { d: formatUnitCost(c), v: { num: (c / 100).toFixed(4).replace('.', ',') } });
const int = (n: number | null | undefined): Cell => (n === null || n === undefined ? { d: '—', v: '' } : { d: String(n), v: n });
const date = (s: string | null | undefined): Cell => (s ? { d: formatDateBR(s.slice(0, 10)), v: s.slice(0, 10) } : { d: '—', v: '' });
const when = (s: string, tz: string): Cell => {
  const dt = new Date(s);
  const d = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(dt);
  return { d, v: d };
};

export const REPORTS: Array<{ name: string; title: string; description: string; kind: 'stock' | 'ledger' | 'special' }> = [
  { name: 'saldo-produto', title: 'Saldo atual por produto', description: 'Quantidade total (todos os depósitos), custo médio e valor gerencial de cada produto.', kind: 'stock' },
  { name: 'saldo-deposito', title: 'Saldo por depósito', description: 'Quantidade e valor de cada produto em cada depósito.', kind: 'stock' },
  { name: 'estoque-categoria', title: 'Estoque por categoria', description: 'Valor gerencial e SKUs com saldo por categoria.', kind: 'stock' },
  { name: 'movimentacoes', title: 'Movimentações por período', description: 'Todos os movimentos do livro, com saldo após cada um e responsável.', kind: 'ledger' },
  { name: 'entradas', title: 'Entradas', description: 'Compras, devoluções, saldos iniciais e outras entradas.', kind: 'ledger' },
  { name: 'saidas', title: 'Saídas', description: 'Vendas, consumo interno, perdas, avarias e demais saídas.', kind: 'ledger' },
  { name: 'transferencias', title: 'Transferências', description: 'Pernas de saída e entrada entre depósitos (não alteram o total).', kind: 'ledger' },
  { name: 'ajustes', title: 'Ajustes', description: 'Ajustes manuais e ajustes de inventário, com motivo.', kind: 'ledger' },
  { name: 'inventarios', title: 'Inventários', description: 'Itens contados, diferenças e situação de cada inventário.', kind: 'special' },
  { name: 'abaixo-minimo', title: 'Produtos abaixo do mínimo', description: 'Nível crítico ou atenção por depósito, com parâmetros de reposição.', kind: 'stock' },
  { name: 'sem-estoque', title: 'Produtos sem estoque', description: 'Produtos ativos com histórico e saldo zero.', kind: 'stock' },
  { name: 'parados', title: 'Produtos parados', description: 'Sem saída operacional no período definido nas configurações.', kind: 'special' },
  { name: 'giro', title: 'Giro de estoque', description: 'Saídas operacionais ÷ estoque médio diário do período.', kind: 'special' },
  { name: 'cobertura', title: 'Cobertura de estoque', description: 'Dias de estoque pelo consumo médio da janela configurada (só com histórico suficiente).', kind: 'special' },
  { name: 'valorizacao', title: 'Valorização gerencial', description: 'Valor do estoque por produto e depósito (custo médio; não é valor contábil nem preço de venda).', kind: 'stock' },
  { name: 'custo-medio', title: 'Custo médio', description: 'Custo médio atual e valor por produto.', kind: 'stock' },
  { name: 'produtos-fornecedor', title: 'Produtos por fornecedor', description: 'Fornecedores associados a cada produto, com SKU, prazo e preferência.', kind: 'special' },
  { name: 'sugestoes-reposicao', title: 'Sugestões de reposição', description: 'Sugestões pendentes de análise (nunca são pedidos de compra).', kind: 'special' },
];
export const REPORT_NAMES = REPORTS.map((r) => r.name);
const MAX_ROWS = 5000;

async function allStock(ctx: Context, f: Filters): Promise<{ rows: StockRow[]; truncated: boolean }> {
  const cats = categoryTree(await loadCategories(ctx), f.category);
  const out: StockRow[] = [];
  const org = ctx.membership.organization_id;
  for (let from = 0; out.length < MAX_ROWS; from += 1000) {
    let q = ctx.supabase.from('inv_stock_view').select('product_id, warehouse_id, sku, product_name, barcode, category_id, unit_symbol, decimal_places, product_status, warehouse_name, warehouse_code, quantity_on_hand, value_cents, average_cost_cents, minimum_quantity, reorder_point, target_quantity, stock_class, monitored, archived_at')
      .eq('organization_id', org).is('archived_at', null).order('product_name').order('warehouse_name');
    if (f.warehouse) q = q.eq('warehouse_id', f.warehouse);
    if (cats?.length) q = q.in('category_id', cats);
    if (f.product) q = q.eq('product_id', f.product);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error('consulta falhou');
    out.push(...((data ?? []) as StockRow[]));
    if ((data ?? []).length < 1000) return { rows: out, truncated: false };
  }
  return { rows: out.slice(0, MAX_ROWS), truncated: true };
}

export async function buildReport(ctx: Context, tz: string, name: string, f: Filters): Promise<Report | null> {
  const meta = REPORTS.find((r) => r.name === name);
  if (!meta) return null;
  const base = { name, title: meta.title, description: meta.description };
  const cats = await loadCategories(ctx);
  const catName = new Map(cats.map((c) => [c.id, c.name]));

  if (['saldo-produto', 'saldo-deposito', 'estoque-categoria', 'abaixo-minimo', 'sem-estoque', 'valorizacao', 'custo-medio'].includes(name)) {
    const { rows, truncated } = await allStock(ctx, f);
    if (name === 'saldo-deposito' || name === 'valorizacao') {
      return { ...base, truncated, head: ['SKU', 'Produto', 'Depósito', 'Saldo', 'Custo médio (R$)', 'Valor (R$)'], rows: rows.map((r) => [txt(r.sku), txt(r.product_name), txt(`${r.warehouse_code} · ${r.warehouse_name}`), qty(r.quantity_on_hand, r.unit_symbol), unitCost(r.average_cost_cents), brl(r.value_cents)]) };
    }
    if (name === 'abaixo-minimo') {
      const list = rows.filter((r) => r.monitored && (r.stock_class === 'critical' || r.stock_class === 'attention' || r.stock_class === 'out_of_stock'));
      return { ...base, truncated, head: ['SKU', 'Produto', 'Depósito', 'Saldo', 'Mínimo', 'Ponto de reposição', 'Estoque-alvo', 'Situação'], rows: list.map((r) => [txt(r.sku), txt(r.product_name), txt(r.warehouse_code), qty(r.quantity_on_hand, r.unit_symbol), qty(r.minimum_quantity), qty(r.reorder_point), qty(r.target_quantity), txt(STOCK_CLASS_LABELS[r.stock_class])]) };
    }
    // agregações por produto (todos os depósitos)
    const byProduct = new Map<string, { r: StockRow; qty: number; value: number }>();
    for (const r of rows) { const e = byProduct.get(r.product_id); if (e) { e.qty += Number(r.quantity_on_hand); e.value += Number(r.value_cents); } else byProduct.set(r.product_id, { r, qty: Number(r.quantity_on_hand), value: Number(r.value_cents) }); }
    const prods = [...byProduct.values()];
    if (name === 'sem-estoque') return { ...base, truncated, head: ['SKU', 'Produto', 'Unidade', 'Categoria'], rows: prods.filter((x) => x.qty === 0).map((x) => [txt(x.r.sku), txt(x.r.product_name), txt(x.r.unit_symbol), txt(x.r.category_id ? catName.get(x.r.category_id) : null)]) };
    if (name === 'estoque-categoria') {
      const g = new Map<string, { skus: number; value: number }>();
      for (const x of prods) { const k = x.r.category_id ? (catName.get(x.r.category_id) ?? '—') : 'Sem categoria'; const e = g.get(k) ?? { skus: 0, value: 0 }; if (x.qty > 0) e.skus++; e.value += x.value; g.set(k, e); }
      return { ...base, truncated, head: ['Categoria', 'SKUs com saldo', 'Valor (R$)'], rows: [...g.entries()].sort((a, b) => b[1].value - a[1].value).map(([k, v]) => [txt(k), int(v.skus), brl(v.value)]) };
    }
    if (name === 'custo-medio') return { ...base, truncated, head: ['SKU', 'Produto', 'Quantidade', 'Custo médio (R$)', 'Valor (R$)'], rows: prods.map((x) => [txt(x.r.sku), txt(x.r.product_name), qty(x.qty, x.r.unit_symbol), unitCost(x.r.average_cost_cents), brl(x.value)]) };
    return { ...base, truncated, head: ['SKU', 'Produto', 'Categoria', 'Saldo total', 'Custo médio (R$)', 'Valor (R$)'], rows: prods.map((x) => [txt(x.r.sku), txt(x.r.product_name), txt(x.r.category_id ? catName.get(x.r.category_id) : null), qty(x.qty, x.r.unit_symbol), unitCost(x.r.average_cost_cents), brl(x.value)]) };
  }

  if (['movimentacoes', 'entradas', 'saidas', 'transferencias', 'ajustes'].includes(name)) {
    const [wh, mv] = await Promise.all([loadWarehouses(ctx), (async () => {
      const all: Awaited<ReturnType<typeof loadMovements>>['rows'] = [];
      for (let page = 1; all.length < MAX_ROWS; page++) {
        const r = await loadMovements(ctx, tz, { from: f.from, to: f.to, warehouse: f.warehouse, product: f.product, user: f.user, type: f.type, page, limit: 500 });
        all.push(...r.rows);
        if (r.rows.length < 500) break;
      }
      return all;
    })()]);
    const types: Record<string, string[]> = { entradas: ['entry', 'opening'], saidas: ['issue'], transferencias: ['transfer_out', 'transfer_in'], ajustes: ['adjustment_in', 'adjustment_out', 'count_in', 'count_out'] };
    const rows0 = types[name] ? mv.filter((m) => types[name]!.includes(m.movement_type)) : mv;
    const pm = await productMap(ctx, rows0.map((m) => m.product_id));
    const whName = new Map(wh.map((w) => [w.id, `${w.code}`]));
    const members = new Map((await ctx.supabase.rpc('inv_member_names', { p_org: ctx.membership.organization_id })).data?.map((m: { user_id: string; display_name: string }) => [m.user_id, m.display_name]) ?? []);
    const truncated = mv.length >= MAX_ROWS;
    return { ...base, truncated, head: ['Data', 'Tipo', 'Motivo', 'SKU', 'Produto', 'Depósito', 'Quantidade', 'Saldo após', 'Valor (R$)', 'Custo', 'Responsável'],
      rows: rows0.slice(0, MAX_ROWS).map((m) => {
        const p = pm.get(m.product_id);
        return [when(m.occurred_at, tz), txt(MOVE_TYPE_LABELS[m.movement_type] ?? m.movement_type), txt(m.reason_code ? (REASON_LABELS[m.reason_code] ?? m.reason_code) : null), txt(p?.sku), txt(p?.name), txt(whName.get(m.warehouse_id)),
          { d: `${formatQty(m.quantity_delta)} ${p?.unit ?? ''}`.trim(), v: { num: String(m.quantity_delta).replace('.', ',') } }, qty(m.balance_after, p?.unit), brl(m.value_delta_cents), txt(m.cost_policy ? COST_POLICY_LABELS[m.cost_policy] : null), txt(members.get(m.performed_by) as string | undefined)];
      }) };
  }

  if (name === 'inventarios') {
    const org = ctx.membership.organization_id;
    const { data: counts, error } = await ctx.supabase.from('physical_counts').select('id, title, status, warehouse_id, completed_at, created_at').eq('organization_id', org).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error('consulta falhou');
    const ids = (counts ?? []).map((c) => c.id as string);
    const { data: items } = ids.length ? await ctx.supabase.from('physical_count_items').select('count_id, product_id, expected_quantity, counted_quantity').eq('organization_id', org).in('count_id', ids) : { data: [] };
    const wh = new Map((await loadWarehouses(ctx)).map((w) => [w.id, w.code]));
    const pm = await productMap(ctx, (items ?? []).map((i) => i.product_id as string));
    const cMap = new Map((counts ?? []).map((c) => [c.id as string, c]));
    const rows: Cell[][] = [];
    for (const i of items ?? []) {
      const c = cMap.get(i.count_id as string)!;
      const p = pm.get(i.product_id as string);
      const diff = i.counted_quantity === null ? null : Number(i.counted_quantity) - Number(i.expected_quantity);
      rows.push([txt(c.title as string), txt(COUNT_STATUS_LABELS[c.status as string]), txt(wh.get(c.warehouse_id as string)), txt(p?.sku), txt(p?.name), qty(i.expected_quantity as number, p?.unit), qty(i.counted_quantity as number | null, p?.unit), diff === null ? txt('não contado') : qty(diff, p?.unit)]);
    }
    return { ...base, truncated: false, head: ['Inventário', 'Situação', 'Depósito', 'SKU', 'Produto', 'Esperado', 'Contado', 'Diferença'], rows };
  }

  if (name === 'parados') {
    const days = (await ctx.supabase.from('inv_settings').select('idle_days').eq('organization_id', ctx.membership.organization_id).maybeSingle()).data?.idle_days as number | undefined ?? 90;
    const r = await loadIdle(ctx, days, f.warehouse);
    return { ...base, description: `${meta.description} (${days} dias)`, truncated: false, head: ['SKU', 'Produto', 'Saldo', 'Valor parado (R$)', 'Última saída operacional', 'Dias sem saída'], rows: r.map((x) => [txt(x.sku), txt(x.name), qty(x.quantity_now, x.unit_symbol), brl(x.value_cents), date(x.last_issue_date), x.days_since_issue === null ? txt('nunca saiu') : int(x.days_since_issue)]) };
  }
  if (name === 'giro' || name === 'cobertura') {
    const r = await loadTurnover(ctx, f);
    if (name === 'giro') return { ...base, truncated: false, head: ['SKU', 'Produto', 'Categoria', 'Saídas operacionais', 'Estoque médio', 'Giro (vezes)', 'Última saída'], rows: r.map((x) => [txt(x.sku), txt(x.name), txt(x.category_name), qty(x.issued_qty, x.unit_symbol), qty(x.average_stock, x.unit_symbol), x.turnover === null ? txt('indisponível') : { d: String(x.turnover).replace('.', ','), v: { num: String(x.turnover).replace('.', ',') } }, date(x.last_issue_date)]) };
    return { ...base, truncated: false, head: ['SKU', 'Produto', 'Saldo atual', 'Cobertura (dias)', 'Última saída'], rows: r.map((x) => [txt(x.sku), txt(x.name), qty(x.quantity_now, x.unit_symbol), x.coverage_days === null ? txt('sem consumo suficiente') : { d: String(x.coverage_days).replace('.', ','), v: { num: String(x.coverage_days).replace('.', ',') } }, date(x.last_issue_date)]) };
  }
  if (name === 'produtos-fornecedor') {
    const org = ctx.membership.organization_id;
    const [{ rows: sup }, ps] = await Promise.all([loadSuppliers(ctx, { includeInactive: true, limit: 1000 }), ctx.supabase.from('product_suppliers').select('product_id, supplier_id, supplier_sku, lead_time_days, is_preferred, last_purchase_cost_cents').eq('organization_id', org).limit(5000)]);
    const sm = new Map(sup.map((s) => [s.id, s.name]));
    const pm = await productMap(ctx, (ps.data ?? []).map((x) => x.product_id as string));
    return { ...base, truncated: false, head: ['Fornecedor', 'SKU', 'Produto', 'SKU no fornecedor', 'Prazo (dias)', 'Preferencial'], rows: (ps.data ?? []).map((x) => [txt(sm.get(x.supplier_id as string)), txt(pm.get(x.product_id as string)?.sku), txt(pm.get(x.product_id as string)?.name), txt(x.supplier_sku as string | null), int(x.lead_time_days as number | null), txt(x.is_preferred ? 'sim' : 'não')]).sort((a, b) => String(a[0]!.v).localeCompare(String(b[0]!.v), 'pt-BR')) };
  }
  if (name === 'sugestoes-reposicao') {
    const sg = await loadSuggestions(ctx, 'pending');
    const pm = await productMap(ctx, sg.map((x) => x.product_id));
    const wh = new Map((await loadWarehouses(ctx)).map((w) => [w.id, w.code]));
    return { ...base, truncated: false, head: ['SKU', 'Produto', 'Depósito', 'Saldo atual', 'Sugerido', 'Critério', 'Situação'], rows: sg.map((x) => [txt(pm.get(x.product_id)?.sku), txt(pm.get(x.product_id)?.name), txt(wh.get(x.warehouse_id)), qty(x.current_quantity, pm.get(x.product_id)?.unit), qty(x.suggested_quantity, pm.get(x.product_id)?.unit), txt(STOCK_CLASS_LABELS[x.criterion]), txt(SUGGESTION_STATUS_LABELS[x.status])]) };
  }
  return null;
}

export const reportToCsv = (r: Report) => toCsv(r.head, r.rows.map((row) => row.map((c) => c.v)));
