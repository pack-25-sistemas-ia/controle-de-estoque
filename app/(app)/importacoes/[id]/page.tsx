import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { Section, TableShell, TD, TH } from '@/components/inventory/bits';
import { CancelImportForm, CommitImportForm } from '@/components/inventory/import-wizard';
import { loadImport } from '@/lib/inventory/data';
import { uuidOrNull } from '@/lib/inventory/filters';
import { IMPORT_TYPE_LABELS, type ImportType } from '@/lib/inventory/labels';
import { pageCtx } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Importação' };

const ROW: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  valid: { label: 'Válida', tone: 'success' }, duplicate: { label: 'Repetida', tone: 'warning' }, error: { label: 'Erro', tone: 'danger' }, imported: { label: 'Importada', tone: 'success' },
};
const SHOW = ['sku', 'name', 'unit', 'warehouse', 'quantity', 'unit_cost', 'minimum', 'reorder_point', 'category', 'parent', 'email'];

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = uuidOrNull(raw);
  if (!id) notFound();
  const p = await pageCtx();
  const d = await loadImport(p.ctx, id);
  if (!d) notFound();
  const { job, rows } = d;
  const kind = job.import_type as ImportType;
  const canAct = kind === 'products' ? p.perms.operator : p.perms.manager;
  const keys = SHOW.filter((k) => rows.some((r) => r.parsed_data[k] !== undefined && r.parsed_data[k] !== '')).slice(0, 5);
  const shown = rows.filter((r) => r.status !== 'valid' && r.status !== 'imported').concat(rows.filter((r) => r.status === 'valid' || r.status === 'imported')).slice(0, 200);
  return (
    <>
      <PageHeader title={job.file_name} description={`${IMPORT_TYPE_LABELS[kind] ?? kind} · ${job.total_rows} linha(s)`}><Link className="text-sm underline underline-offset-2" href="/importacoes">Voltar</Link></PageHeader>
      <div className="mb-4 grid gap-3 sm:grid-cols-4 text-sm">
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-muted">Válidas</p><p className="text-2xl font-semibold tabular-nums">{job.valid_rows}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-muted">Repetidas (ignoradas)</p><p className="text-2xl font-semibold tabular-nums">{job.duplicate_rows}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-muted">Com erro</p><p className="text-2xl font-semibold tabular-nums">{job.error_rows}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-muted">Importadas</p><p className="text-2xl font-semibold tabular-nums">{job.accepted_rows}</p></div>
      </div>
      {job.status === 'previewed' ? (
        <div className="mb-6 space-y-3">
          <Alert tone="info">Isto é só uma prévia: nada foi criado. Ao confirmar, entram apenas as {job.valid_rows} linhas válidas, de uma vez só (se algo falhar, nada entra).{kind === 'opening' ? ' Cada saldo inicial vira um movimento de abertura no histórico.' : ''}</Alert>
          {canAct ? (
            <div className="flex flex-wrap items-start gap-4">
              {job.valid_rows > 0 ? <CommitImportForm id={id} kind={kind} validRows={job.valid_rows} /> : <p className="text-sm text-danger">Não há linhas válidas para importar.</p>}
              <CancelImportForm id={id} />
            </div>
          ) : <p className="text-sm text-muted">Apenas {kind === 'products' ? 'operadores, gestores e administradores' : 'gestores e administradores'} confirmam este tipo de importação.</p>}
        </div>
      ) : null}
      {job.error_rows + job.duplicate_rows > 0 ? <p className="mb-3 text-sm"><a className="underline underline-offset-2" href={`/api/imports/${id}/erros`}>Baixar relatório de erros e repetições (CSV)</a></p> : null}
      <Section title="Linhas" description={rows.length > 200 ? 'Mostrando as 200 primeiras (erros primeiro). O relatório em CSV traz todas.' : undefined}>
        <TableShell caption="Linhas da importação" empty={rows.length === 0}>
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Linha</th><th scope="col" className={TH}>Situação</th>{keys.map((k) => <th scope="col" key={k} className={TH}>{k}</th>)}<th scope="col" className={TH}>Motivo</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 align-top">
              <td className={`${TD} tabular-nums`}>{r.row_number}</td><td className={TD}><Badge tone={ROW[r.status]?.tone}>{ROW[r.status]?.label ?? r.status}</Badge></td>
              {keys.map((k) => <td key={k} className={`${TD} max-w-40 truncate`}>{String(r.parsed_data[k] ?? '')}</td>)}
              <td className={`${TD} text-danger`}>{r.error_message ?? ''}</td>
            </tr>
          ))}</tbody>
        </TableShell>
      </Section>
    </>
  );
}
