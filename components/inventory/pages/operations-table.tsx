import Link from 'next/link';
import { Badge } from '@/components/ui/primitives';
import type { MemberName, OperationRow, WarehouseRow } from '@/lib/inventory/data';
import { OP_TYPE_LABELS, REASON_LABELS, type OpType } from '@/lib/inventory/labels';
import { DateTimeBR, TableShell, TD, TH } from '../bits';

/** Lista de operações (documentos do estoque). Cada linha abre o detalhe com itens, movimentos, estorno e anexos. */
export function OperationsTable({ rows, warehouses, members, tz, itemCounts }: { rows: OperationRow[]; warehouses: WarehouseRow[]; members: MemberName[]; tz: string; itemCounts?: Map<string, number> }) {
  const wh = new Map(warehouses.map((w) => [w.id, w.code]));
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  return (
    <TableShell caption="Operações de estoque" empty={rows.length === 0} emptyText="Nenhuma operação encontrada com estes filtros.">
      <thead><tr className="border-b border-border"><th scope="col" className={TH}>Nº</th><th scope="col" className={TH}>Data</th><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Motivo</th><th scope="col" className={TH}>Depósito</th><th scope="col" className={TH}>Itens</th><th scope="col" className={TH}>Referência</th><th scope="col" className={TH}>Responsável</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}><span className="sr-only">Abrir</span></th></tr></thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id} className="border-b border-border last:border-0">
            <td className={`${TD} tabular-nums`}>{o.org_number}</td>
            <td className={TD}><DateTimeBR value={o.occurred_at} tz={tz} /></td>
            <td className={TD}>{OP_TYPE_LABELS[o.operation_type as OpType] ?? o.operation_type}</td>
            <td className={TD}>{o.reason_code ? (REASON_LABELS[o.reason_code] ?? o.reason_code) : '—'}</td>
            <td className={TD}>{o.operation_type === 'transfer' ? `${wh.get(o.source_warehouse_id ?? '') ?? '?'} → ${wh.get(o.destination_warehouse_id ?? '') ?? '?'}` : (wh.get(o.warehouse_id ?? '') ?? '—')}</td>
            <td className={`${TD} tabular-nums`}>{itemCounts?.get(o.id) ?? '—'}</td>
            <td className={TD}>{o.external_reference ?? '—'}</td>
            <td className={TD}>{who.get(o.created_by) ?? '—'}</td>
            <td className={TD}>{o.status === 'reversed' ? <Badge tone="warning">Estornada</Badge> : o.operation_type === 'reversal' ? <Badge>Estorno</Badge> : <Badge tone="success">Confirmada</Badge>}</td>
            <td className={TD}><Link className="underline underline-offset-2" href={`/movimentacoes/${o.id}`}>Abrir</Link></td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}
