import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { ClassBadge, Money, Pagination, Qty, TableShell, TD, TDR, TH, THR } from '@/components/inventory/bits';
import { ListFilters } from '@/components/inventory/filter-bar';
import { categoryTree, loadStock } from '@/lib/inventory/data';
import { one, pageFrom, type SearchParams, uuidOrNull } from '@/lib/inventory/filters';
import { STOCK_CLASS_LABELS } from '@/lib/inventory/labels';
import { formatUnitCost } from '@/lib/inventory/qty';
import { categoryOpts, loadRefs, pageCtx, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Saldos' };

export default async function SaldosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const page = pageFrom(one(sp.page));
  const wh = uuidOrNull(one(sp.wh));
  const cat = uuidOrNull(one(sp.category));
  const cls = one(sp.cls) && one(sp.cls)! in STOCK_CLASS_LABELS ? one(sp.cls)! : null;
  const q = one(sp.q);
  const withBalance = one(sp.bal) === '1';
  const { rows, total } = await loadStock(p.ctx, { q, warehouse: wh, category: categoryTree(refs.categories, cat), cls, withBalance, page });
  const empty = total === 0 && !q && !wh && !cat && !cls && !withBalance;
  return (
    <>
      <PageHeader title="Saldos por produto e depósito" description="Físico = soma dos movimentos. Disponível = físico − reservado (sem reservas neste sistema, disponível = físico). O valor é gerencial: custo médio × quantidade, distribuído entre os depósitos sem perder centavos." />
      <ListFilters action="/saldos" values={{ q, wh: wh ?? '', category: cat ?? '', cls: cls ?? '', bal: withBalance ? '1' : '' }}
        fields={[
          { name: 'q', label: 'Buscar (nome, SKU ou código)', width: 'w-64' },
          { name: 'wh', label: 'Depósito', options: warehouseOpts(refs.warehouses, true), all: 'Todos' },
          { name: 'category', label: 'Categoria', options: categoryOpts(refs.categories), all: 'Todas', width: 'w-48' },
          { name: 'cls', label: 'Situação de reposição', options: Object.entries(STOCK_CLASS_LABELS).map(([value, label]) => ({ value, label })), all: 'Todas', width: 'w-44' },
          { name: 'bal', label: 'Saldo', options: [{ value: '1', label: 'Só com saldo' }], all: 'Todos', width: 'w-36' },
        ]} />
      {p.perms.manager ? <p className="mb-3 text-sm"><Link className="underline underline-offset-2" href={`/api/export/saldo-deposito?wh=${wh ?? ''}&category=${cat ?? ''}`}>Exportar saldos (CSV)</Link></p> : null}
      {empty ? (
        <EmptyState title="Ainda não há saldo" description="Os saldos aparecem depois da primeira entrada ou do lançamento de saldo inicial.">{p.perms.operator ? <Link className="underline" href="/entradas">Registrar entrada</Link> : null}</EmptyState>
      ) : (
        <TableShell caption="Saldos" empty={rows.length === 0} emptyText="Nenhum saldo encontrado com estes filtros.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>SKU</th><th scope="col" className={TH}>Produto</th><th scope="col" className={TH}>Depósito</th><th scope="col" className={THR}>Físico</th><th scope="col" className={THR}>Disponível</th><th scope="col" className={THR}>Custo médio</th><th scope="col" className={THR}>Valor</th><th scope="col" className={TH}>Reposição</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={`${r.product_id}-${r.warehouse_id}`} className="border-b border-border last:border-0">
              <td className={TD}><Link className="font-medium underline-offset-2 hover:underline" href={`/produtos/${r.product_id}`}>{r.sku}</Link></td>
              <td className={TD}>{r.product_name}</td><td className={TD}>{r.warehouse_code}</td>
              <td className={TDR}><Qty value={r.quantity_on_hand} unit={r.unit_symbol} /></td><td className={TDR}><Qty value={r.quantity_on_hand} unit={r.unit_symbol} /></td>
              <td className={TDR}>{r.average_cost_cents === null ? '—' : formatUnitCost(r.average_cost_cents)}</td><td className={TDR}><Money cents={r.value_cents} /></td>
              <td className={TD}>{r.monitored ? <ClassBadge cls={r.stock_class} /> : <span className="text-muted">sem regra</span>}</td>
            </tr>
          ))}</tbody>
        </TableShell>
      )}
      <Pagination base="/saldos" sp={sp} page={page} total={total} />
    </>
  );
}
