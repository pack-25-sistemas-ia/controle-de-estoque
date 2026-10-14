import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { AttachmentPanel } from '@/components/inventory/attachments';
import { DateTimeBR, Disclosure, Qty, Section, TableShell, TD, TDR, TH, THR } from '@/components/inventory/bits';
import { CancelCountForm, CountRow, IdForm, SurplusCostForm } from '@/components/inventory/count-forms';
import { loadAttachments, loadCount, loadMemberNames, loadWarehouses, productMap } from '@/lib/inventory/data';
import { uuidOrNull } from '@/lib/inventory/filters';
import { COUNT_STATUS_LABELS, COUNT_STATUS_TONES } from '@/lib/inventory/labels';
import { pageCtx } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Inventário' };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = uuidOrNull(raw);
  if (!id) notFound();
  const p = await pageCtx();
  const d = await loadCount(p.ctx, id);
  if (!d) notFound();
  const { count, items, currentVersions } = d;
  const [warehouses, members, pm, atts] = await Promise.all([loadWarehouses(p.ctx), loadMemberNames(p.ctx), productMap(p.ctx, items.map((i) => i.product_id)), loadAttachments(p.ctx, 'count', id)]);
  const wh = warehouses.find((w) => w.id === count.warehouse_id);
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  const counting = count.status === 'counting';
  const waiting = count.status === 'awaiting_approval';
  const open = counting || waiting;
  const rows = [...items].sort((a, b) => (pm.get(a.product_id)?.sku ?? '').localeCompare(pm.get(b.product_id)?.sku ?? ''));
  const stale = (i: (typeof items)[number]) => i.counted_quantity !== null && (currentVersions.get(i.product_id)?.version ?? i.balance_version_at_snapshot) !== i.balance_version_at_snapshot;
  const staleCount = rows.filter(stale).length;
  const counted = rows.filter((i) => i.counted_quantity !== null).length;
  const diffs = rows.filter((i) => i.counted_quantity !== null && Number(i.counted_quantity) !== Number(i.expected_quantity)).length;
  return (
    <>
      <PageHeader title={count.title} description={`Depósito ${wh ? `${wh.code} · ${wh.name}` : '—'} · iniciado por ${who.get(count.created_by) ?? '—'}`}>
        <div className="flex items-center gap-3"><Badge tone={COUNT_STATUS_TONES[count.status] ?? 'neutral'}>{COUNT_STATUS_LABELS[count.status] ?? count.status}</Badge><Link className="text-sm underline underline-offset-2" href="/inventarios">Voltar</Link></div>
      </PageHeader>
      {count.notes ? <p className="mb-4 whitespace-pre-line text-sm text-muted">{count.notes}</p> : null}
      <p className="mb-4 text-sm">Congelado em <DateTimeBR value={count.started_at} tz={p.tz} />. {counted} de {rows.length} itens contados · {diffs} com diferença{count.completed_at ? <> · concluído em <DateTimeBR value={count.completed_at} tz={p.tz} /></> : null}.</p>
      {open && staleCount > 0 ? <div className="mb-4"><Alert tone="warning">{staleCount} item(ns) tiveram o saldo alterado por outras movimentações depois do início da contagem. {p.perms.manager && waiting ? 'A aprovação fica bloqueada: reabra o inventário para recontar esses itens.' : 'O gestor precisa reabrir o inventário para recontá-los.'}</Alert></div> : null}

      <Section title="Itens" description={counting ? 'Digite a quantidade encontrada em cada item e clique em Registrar. A diferença é calculada sobre a quantidade esperada congelada.' : undefined}>
        <TableShell caption="Itens do inventário" empty={rows.length === 0}>
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Produto</th><th scope="col" className={THR}>Esperado</th><th scope="col" className={TH}>Contado</th><th scope="col" className={THR}>Diferença</th><th scope="col" className={TH}>Situação</th>{p.perms.manager && open ? <th scope="col" className={TH}>Custo da sobra</th> : null}</tr></thead>
          <tbody>{rows.map((i) => {
            const pr = pm.get(i.product_id);
            const diff = i.counted_quantity === null ? null : Number(i.counted_quantity) - Number(i.expected_quantity);
            return (
              <tr key={i.id} className="border-b border-border last:border-0 align-top">
                <td className={TD}><Link className="font-medium underline-offset-2 hover:underline" href={`/produtos/${i.product_id}`}>{pr?.sku}</Link><span className="block text-xs text-muted">{pr?.name}</span></td>
                <td className={TDR}><Qty value={i.expected_quantity} unit={pr?.unit} /></td>
                <td className={TD}>{counting && p.perms.operator ? <CountRow itemId={i.id} counted={i.counted_quantity} unit={pr?.unit ?? ''} disabled={false} /> : i.counted_quantity === null ? <span className="text-muted">não contado</span> : <Qty value={i.counted_quantity} unit={pr?.unit} />}</td>
                <td className={TDR}>{diff === null ? '—' : <Qty value={diff} unit={pr?.unit} signed />}</td>
                <td className={TD}>{stale(i) ? <Badge tone="warning">Saldo mudou: recontar</Badge> : i.adjustment_operation_id ? <Link className="underline" href={`/movimentacoes/${i.adjustment_operation_id}`}>Ajustado</Link> : diff === null ? '—' : diff === 0 ? <Badge tone="success">Confere</Badge> : <Badge tone="danger">Divergente</Badge>}</td>
                {p.perms.manager && open ? <td className={TD}>{diff !== null && diff > 0 ? <SurplusCostForm itemId={i.id} value={i.surplus_unit_cost_cents} /> : <span className="text-muted">—</span>}</td> : null}
              </tr>
            );
          })}</tbody>
        </TableShell>
      </Section>

      {open ? (
        <Section title="Próximos passos">
          <div className="flex flex-wrap items-start gap-4">
            {counting && p.perms.operator ? <IdForm id={id} action="submit" label="Enviar para aprovação" pending="Enviando…" /> : null}
            {waiting && p.perms.manager ? <IdForm id={id} action="approve" label="Aprovar e gerar ajustes" pending="Aprovando…" /> : null}
            {waiting && p.perms.manager ? <IdForm id={id} action="reopen" label="Reabrir itens com saldo alterado" variant="secondary" pending="Reabrindo…" /> : null}
          </div>
          <p className="mt-2 text-xs text-muted">Sobra sem custo médio disponível exige o custo informado (coluna «Custo da sobra»). Faltas saem ao custo médio atual. Nada é aplicado antes da aprovação.</p>
          {p.perms.operator ? <div className="mt-4"><Disclosure summary="Cancelar inventário" tone="danger"><CancelCountForm id={id} /></Disclosure></div> : null}
        </Section>
      ) : null}

      <Section title="Documentos" description="Folha de contagem assinada, fotos ou relatórios (PDF, PNG ou JPG).">
        <AttachmentPanel entityType="count" entityId={id} items={atts} canUpload={p.perms.operator} />
      </Section>
    </>
  );
}
