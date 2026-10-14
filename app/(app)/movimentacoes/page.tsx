import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Money, Pagination, Qty, TableShell, TD, TDR, TH, THR } from '@/components/inventory/bits';
import { ListFilters } from '@/components/inventory/filter-bar';
import { loadMemberNames, loadMovements, loadWarehouses, productMap } from '@/lib/inventory/data';
import { isIsoDateLoose, one, pageFrom, type SearchParams, uuidOrNull } from '@/lib/inventory/filters';
import { COST_POLICY_LABELS, MOVE_TYPE_LABELS, REASON_LABELS } from '@/lib/inventory/labels';
import { pageCtx, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Movimentações' };

export default async function MovimentacoesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const page = pageFrom(one(sp.page));
  const wh = uuidOrNull(one(sp.wh));
  const type = one(sp.type) && MOVE_TYPE_LABELS[one(sp.type)!] ? one(sp.type)! : null;
  const from = isIsoDateLoose(one(sp.from)) ? one(sp.from)! : undefined;
  const to = isIsoDateLoose(one(sp.to)) ? one(sp.to)! : undefined;
  const [warehouses, members] = await Promise.all([loadWarehouses(p.ctx), loadMemberNames(p.ctx)]);
  const mv = await loadMovements(p.ctx, p.tz, { warehouse: wh, type, from, to, page });
  const pm = await productMap(p.ctx, mv.rows.map((m) => m.product_id));
  const whName = new Map(warehouses.map((w) => [w.id, w.code]));
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  return (
    <>
      <PageHeader title="Histórico de movimentações" description="O livro do estoque: cada linha é um movimento confirmado e imutável. Correções aparecem como estornos ligados ao movimento original. O saldo de cada produto é a soma destes movimentos." />
      <ListFilters action="/movimentacoes" values={{ wh: wh ?? '', type: type ?? '', from, to }}
        fields={[
          { name: 'wh', label: 'Depósito', options: warehouseOpts(warehouses, true), all: 'Todos' },
          { name: 'type', label: 'Tipo', options: Object.entries(MOVE_TYPE_LABELS).map(([value, label]) => ({ value, label })), all: 'Todos', width: 'w-56' },
          { name: 'from', label: 'De', type: 'date' }, { name: 'to', label: 'Até', type: 'date' },
        ]} />
      <TableShell caption="Movimentos do estoque" empty={mv.rows.length === 0} emptyText="Nenhum movimento encontrado.">
        <thead><tr className="border-b border-border"><th scope="col" className={TH}>Data</th><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Produto</th><th scope="col" className={TH}>Depósito</th><th scope="col" className={THR}>Quantidade</th><th scope="col" className={THR}>Saldo após</th><th scope="col" className={THR}>Valor</th><th scope="col" className={TH}>Custo</th><th scope="col" className={TH}>Responsável</th><th scope="col" className={TH}><span className="sr-only">Operação</span></th></tr></thead>
        <tbody>
          {mv.rows.map((m) => {
            const pr = pm.get(m.product_id);
            return (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className={TD}><DateTimeBR value={m.occurred_at} tz={p.tz} /></td>
                <td className={TD}>{MOVE_TYPE_LABELS[m.movement_type] ?? m.movement_type}{m.reason_code ? <span className="block text-xs text-muted">{REASON_LABELS[m.reason_code] ?? m.reason_code}</span> : null}</td>
                <td className={TD}><Link className="font-medium underline-offset-2 hover:underline" href={`/produtos/${m.product_id}`}>{pr?.sku ?? '—'}</Link><span className="block text-xs text-muted">{pr?.name}</span></td>
                <td className={TD}>{whName.get(m.warehouse_id) ?? '—'}</td>
                <td className={TDR}><Qty value={m.quantity_delta} unit={pr?.unit} signed /></td>
                <td className={TDR}><Qty value={m.balance_after} unit={pr?.unit} /></td>
                <td className={TDR}><Money cents={m.value_delta_cents} signed /></td>
                <td className={TD}>{m.cost_policy ? COST_POLICY_LABELS[m.cost_policy] : '—'}</td>
                <td className={TD}>{who.get(m.performed_by) ?? '—'}</td>
                <td className={TD}><Link className="underline underline-offset-2" href={`/movimentacoes/${m.operation_id}`}>Operação</Link></td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
      <Pagination base="/movimentacoes" sp={sp} page={page} total={mv.total} />
    </>
  );
}
