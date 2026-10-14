import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ClassBadge, DateTimeBR, Qty, Section, Tabs, TableShell, TD, TDR, TH, THR } from '@/components/inventory/bits';
import { ReviewSuggestionForm, RunRoutinesForm } from '@/components/inventory/count-forms';
import { ListFilters } from '@/components/inventory/filter-bar';
import { loadStock, loadSuggestions, loadSuppliers, loadWarehouses, productMap } from '@/lib/inventory/data';
import { one, type SearchParams, uuidOrNull } from '@/lib/inventory/filters';
import { SUGGESTION_STATUS_LABELS } from '@/lib/inventory/labels';
import { pageCtx, supplierOpts, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Reposição' };

export default async function ReposicaoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const status = ['pending', 'reviewed', 'dismissed'].includes(one(sp.status) ?? '') ? one(sp.status)! : 'pending';
  const wh = uuidOrNull(one(sp.wh));
  const sup = uuidOrNull(one(sp.supplier));
  const [warehouses, suppliers, sugAll] = await Promise.all([loadWarehouses(p.ctx), loadSuppliers(p.ctx, { limit: 1000 }), loadSuggestions(p.ctx, status)]);
  let sugs = wh ? sugAll.filter((s) => s.warehouse_id === wh) : sugAll;
  const pm = await productMap(p.ctx, sugs.map((s) => s.product_id));
  // fornecedor preferencial / principal por produto
  const { data: prods } = sugs.length ? await p.ctx.supabase.from('products').select('id, default_supplier_id').eq('organization_id', p.org).in('id', [...new Set(sugs.map((s) => s.product_id))]) : { data: [] };
  const supOf = new Map((prods ?? []).map((x) => [x.id as string, x.default_supplier_id as string | null]));
  if (sup) sugs = sugs.filter((s) => supOf.get(s.product_id) === sup);
  const supName = new Map(suppliers.rows.map((s) => [s.id, s.name]));
  const whName = new Map(warehouses.map((w) => [w.id, w.code]));
  const crit = await loadStock(p.ctx, { cls: 'critical', limit: 1 });
  const out = await loadStock(p.ctx, { cls: 'out_of_stock', limit: 1 });
  const att = await loadStock(p.ctx, { cls: 'attention', limit: 1 });
  return (
    <>
      <PageHeader title="Reposição de estoque" description="Produtos que pedem análise de compra, pelos parâmetros de mínimo, ponto de reposição e estoque-alvo. São sugestões simples e observadas: não são previsão de demanda nem pedidos de compra." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-muted">Sem estoque</p><p className="text-2xl font-semibold tabular-nums">{out.total}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-muted">Crítico (≤ mínimo)</p><p className="text-2xl font-semibold tabular-nums">{crit.total}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-muted">Atenção (≤ ponto de reposição)</p><p className="text-2xl font-semibold tabular-nums">{att.total}</p></div>
      </div>
      {p.perms.operator ? <div className="mb-4"><RunRoutinesForm /></div> : null}
      <Tabs current={status} items={[{ key: 'pending', label: 'Pendentes', href: '/reposicao?status=pending' }, { key: 'reviewed', label: 'Analisadas', href: '/reposicao?status=reviewed' }, { key: 'dismissed', label: 'Descartadas', href: '/reposicao?status=dismissed' }]} />
      <ListFilters action="/reposicao" hidden={{ status }} values={{ wh: wh ?? '', supplier: sup ?? '' }}
        fields={[{ name: 'wh', label: 'Depósito', options: warehouseOpts(warehouses, true) }, { name: 'supplier', label: 'Fornecedor principal', options: supplierOpts(suppliers.rows), width: 'w-52' }]} />
      <Section title={`${SUGGESTION_STATUS_LABELS[status]} (${sugs.length})`} actions={p.perms.manager ? <Link className="text-sm underline underline-offset-2" href="/api/export/sugestoes-reposicao">Exportar sugestões (CSV)</Link> : undefined}>
        {sugs.length === 0 ? (
          <EmptyState title={status === 'pending' ? 'Nada pede reposição agora' : 'Nenhuma sugestão nesta situação'} description="Defina mínimo, ponto de reposição e estoque-alvo nos produtos e use «Atualizar sugestões e avisos agora»." />
        ) : (
          <TableShell caption="Sugestões de reposição">
            <thead><tr className="border-b border-border"><th scope="col" className={TH}>Produto</th><th scope="col" className={TH}>Depósito</th><th scope="col" className={TH}>Fornecedor</th><th scope="col" className={THR}>Saldo atual</th><th scope="col" className={TH}>Critério</th><th scope="col" className={THR}>Sugerido</th><th scope="col" className={TH}>Gerada em</th>{p.perms.manager && status === 'pending' ? <th scope="col" className={TH}>Análise</th> : null}</tr></thead>
            <tbody>{sugs.map((s) => {
              const pr = pm.get(s.product_id);
              return (
                <tr key={s.id} className="border-b border-border last:border-0 align-top">
                  <td className={TD}><Link className="font-medium underline-offset-2 hover:underline" href={`/produtos/${s.product_id}`}>{pr?.sku}</Link><span className="block text-xs text-muted">{pr?.name}</span></td>
                  <td className={TD}>{whName.get(s.warehouse_id) ?? '—'}</td><td className={TD}>{supName.get(supOf.get(s.product_id) ?? '') ?? '—'}</td>
                  <td className={TDR}><Qty value={s.current_quantity} unit={pr?.unit} /></td><td className={TD}><ClassBadge cls={s.criterion} /></td>
                  <td className={TDR}>{s.suggested_quantity === null ? <span className="text-muted">defina o estoque-alvo</span> : <Qty value={s.suggested_quantity} unit={pr?.unit} />}</td>
                  <td className={TD}><DateTimeBR value={s.generated_at} tz={p.tz} /></td>
                  {p.perms.manager && status === 'pending' ? <td className={TD}><ReviewSuggestionForm id={s.id} suggested={s.suggested_quantity} /></td> : null}
                </tr>
              );
            })}</tbody>
          </TableShell>
        )}
      </Section>
      <Alert tone="info">Quantidade sugerida = estoque-alvo − saldo disponível. O sistema não conhece compras futuras ou em trânsito e não as inventa: considere pedidos já feitos antes de comprar.</Alert>
    </>
  );
}
