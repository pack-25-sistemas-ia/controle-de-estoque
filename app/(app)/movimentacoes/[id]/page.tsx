import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { AttachmentPanel } from '@/components/inventory/attachments';
import { DateTimeBR, Disclosure, Money, Qty, Section, TableShell, TD, TDR, TH, THR } from '@/components/inventory/bits';
import { ReverseForm } from '@/components/inventory/operation-forms';
import { loadAttachments, loadMemberNames, loadOperation, loadWarehouses, productMap } from '@/lib/inventory/data';
import { uuidOrNull } from '@/lib/inventory/filters';
import { COST_POLICY_LABELS, MOVE_TYPE_LABELS, OP_TYPE_LABELS, REASON_LABELS, type OpType } from '@/lib/inventory/labels';
import { formatUnitCost } from '@/lib/inventory/qty';
import { pageCtx } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Operação de estoque' };

export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = uuidOrNull(raw);
  if (!id) notFound();
  const p = await pageCtx();
  const d = await loadOperation(p.ctx, id);
  if (!d) notFound();
  const { op, items, movements } = d;
  const [warehouses, members, atts] = await Promise.all([loadWarehouses(p.ctx), loadMemberNames(p.ctx), loadAttachments(p.ctx, 'operation', id)]);
  const pm = await productMap(p.ctx, items.map((i) => i.product_id));
  const wh = new Map(warehouses.map((w) => [w.id, `${w.code} · ${w.name}`]));
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  const reversal = op.reversal_of_operation_id;
  const canReverse = p.perms.manager && op.status === 'confirmed' && op.operation_type !== 'reversal';
  const title = `${OP_TYPE_LABELS[op.operation_type as OpType] ?? op.operation_type} nº ${op.org_number}`;
  return (
    <>
      <PageHeader title={title} description={op.reason_code ? (REASON_LABELS[op.reason_code] ?? op.reason_code) : undefined}>
        <Link className="underline underline-offset-2" href="/movimentacoes">Voltar ao histórico</Link>
      </PageHeader>
      {op.status === 'reversed' ? <div className="mb-4"><Alert tone="warning">Esta operação foi estornada em <DateTimeBR value={op.reversed_at} tz={p.tz} />. Os movimentos originais permanecem no histórico e o estorno os compensa.</Alert></div> : null}
      {reversal ? <div className="mb-4"><Alert tone="info">Este é um estorno da <Link className="underline" href={`/movimentacoes/${reversal}`}>operação original</Link>. Motivo: {op.reversal_reason}</Alert></div> : null}

      <Card className="mb-6 p-4">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted">Data</dt><dd><DateTimeBR value={op.occurred_at} tz={p.tz} /></dd></div>
          <div><dt className="text-muted">Responsável</dt><dd>{who.get(op.created_by) ?? '—'}</dd></div>
          <div><dt className="text-muted">Situação</dt><dd>{op.status === 'reversed' ? <Badge tone="warning">Estornada</Badge> : <Badge tone="success">Confirmada</Badge>}</dd></div>
          <div><dt className="text-muted">Depósito</dt><dd>{op.operation_type === 'transfer' ? `${wh.get(op.source_warehouse_id ?? '') ?? '?'} → ${wh.get(op.destination_warehouse_id ?? '') ?? '?'}` : (wh.get(op.warehouse_id ?? '') ?? '—')}</dd></div>
          <div><dt className="text-muted">Referência</dt><dd>{op.external_reference ?? '—'}</dd></div>
          <div><dt className="text-muted">Observações</dt><dd>{op.notes ?? '—'}</dd></div>
        </dl>
        {op.count_id ? <p className="mt-3 text-sm">Gerada pelo <Link className="underline" href={`/inventarios/${op.count_id}`}>inventário</Link>.</p> : null}
      </Card>

      <Section title="Itens" description="Quantidade e custo unitário usados em cada linha. O custo de saídas e ajustes negativos é o custo médio vigente no momento.">
        <TableShell caption="Itens da operação" empty={items.length === 0}>
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>#</th><th scope="col" className={TH}>Produto</th><th scope="col" className={THR}>Quantidade</th><th scope="col" className={THR}>Custo unitário</th><th scope="col" className={TH}>Política de custo</th></tr></thead>
          <tbody>{items.map((i) => {
            const pr = pm.get(i.product_id);
            return (
              <tr key={i.id} className="border-b border-border last:border-0">
                <td className={`${TD} tabular-nums`}>{i.line_no}</td>
                <td className={TD}><Link className="font-medium underline-offset-2 hover:underline" href={`/produtos/${i.product_id}`}>{pr?.sku ?? '—'}</Link><span className="block text-xs text-muted">{pr?.name}</span></td>
                <td className={TDR}><Qty value={i.quantity} unit={pr?.unit} /></td>
                <td className={TDR}>{i.unit_cost_cents === null ? '—' : formatUnitCost(i.unit_cost_cents)}</td>
                <td className={TD}>{i.cost_policy ? COST_POLICY_LABELS[i.cost_policy] : '—'}</td>
              </tr>
            );
          })}</tbody>
        </TableShell>
      </Section>

      <Section title="Movimentos no livro" description="O que realmente alterou o saldo. Cada linha é imutável.">
        <TableShell caption="Movimentos gerados" empty={movements.length === 0}>
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Produto</th><th scope="col" className={TH}>Depósito</th><th scope="col" className={THR}>Quantidade</th><th scope="col" className={THR}>Saldo após</th><th scope="col" className={THR}>Valor</th></tr></thead>
          <tbody>{movements.map((m) => {
            const pr = pm.get(m.product_id);
            return (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className={TD}>{MOVE_TYPE_LABELS[m.movement_type] ?? m.movement_type}</td>
                <td className={TD}>{pr?.sku} <span className="text-xs text-muted">{pr?.name}</span></td>
                <td className={TD}>{wh.get(m.warehouse_id) ?? '—'}</td>
                <td className={TDR}><Qty value={m.quantity_delta} unit={pr?.unit} signed /></td>
                <td className={TDR}><Qty value={m.balance_after} unit={pr?.unit} /></td>
                <td className={TDR}><Money cents={m.value_delta_cents} signed /></td>
              </tr>
            );
          })}</tbody>
        </TableShell>
      </Section>

      <Section title="Documentos anexados" description="Nota fiscal, comprovante ou foto (PDF, PNG ou JPG, até 10 MB). O tipo é conferido pelo conteúdo do arquivo.">
        <AttachmentPanel entityType="operation" entityId={id} items={atts} canUpload={p.perms.operator} />
      </Section>

      {canReverse ? (
        <Section title="Corrigir" description="Para desfazer esta operação, estorne-a. O estorno é recusado se deixaria o saldo negativo ou o custo inconsistente.">
          <Disclosure summary="Estornar esta operação" tone="danger"><ReverseForm id={id} /></Disclosure>
        </Section>
      ) : null}
    </>
  );
}
