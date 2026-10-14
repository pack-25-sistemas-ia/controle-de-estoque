import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Disclosure, Pagination, Section, TableShell, TDR, TD, TH, THR } from '@/components/inventory/bits';
import { ImportWizard } from '@/components/inventory/import-wizard';
import { loadImports } from '@/lib/inventory/data';
import { one, pageFrom, type SearchParams } from '@/lib/inventory/filters';
import { IMPORT_TYPE_LABELS, type ImportType } from '@/lib/inventory/labels';
import { pageCtx } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Importações' };

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }> = { previewed: { label: 'Aguardando confirmação', tone: 'warning' }, completed: { label: 'Concluída', tone: 'success' }, cancelled: { label: 'Cancelada', tone: 'neutral' } };

export default async function ImportacoesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const page = pageFrom(one(sp.page));
  const jobs = await loadImports(p.ctx, page);
  return (
    <>
      <PageHeader title="Importações (CSV)" description="Cadastre muitos itens de uma vez. O arquivo passa por uma prévia que mostra erros e repetições; nada é criado antes da sua confirmação. O saldo inicial entra como movimento de abertura, nunca como edição de saldo." />
      {p.perms.operator ? (
        <div className="mb-6 space-y-3">
          <Disclosure summary="Nova importação" open tone="primary"><ImportWizard canManager={p.perms.manager} /></Disclosure>
          <Alert tone="info">Aceitamos CSV (separado por ponto e vírgula, vírgula ou tabulação; números com vírgula decimal). Planilhas XLSX não são lidas: no Excel, use «Salvar como → CSV». Ordem sugerida: categorias e fornecedores → produtos → saldo inicial → regras de reposição.</Alert>
        </div>
      ) : null}
      <Section title="Histórico de importações">
        {jobs.total === 0 ? <EmptyState title="Nenhuma importação ainda" description="Os arquivos importados e seus resultados aparecem aqui." /> : (
          <TableShell caption="Importações">
            <thead><tr className="border-b border-border"><th scope="col" className={TH}>Arquivo</th><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Data</th><th scope="col" className={TH}>Situação</th><th scope="col" className={THR}>Linhas</th><th scope="col" className={THR}>Válidas</th><th scope="col" className={THR}>Repetidas</th><th scope="col" className={THR}>Com erro</th><th scope="col" className={TH}><span className="sr-only">Abrir</span></th></tr></thead>
            <tbody>{jobs.rows.map((j) => (
              <tr key={j.id} className="border-b border-border last:border-0">
                <td className={`${TD} max-w-56 truncate`}>{j.file_name}</td><td className={TD}>{IMPORT_TYPE_LABELS[j.import_type as ImportType] ?? j.import_type}</td>
                <td className={TD}><DateTimeBR value={j.created_at} tz={p.tz} /></td><td className={TD}><Badge tone={STATUS[j.status]?.tone}>{STATUS[j.status]?.label ?? j.status}</Badge></td>
                <td className={TDR}>{j.total_rows}</td><td className={TDR}>{j.valid_rows}</td><td className={TDR}>{j.duplicate_rows}</td><td className={TDR}>{j.error_rows}</td>
                <td className={TD}><Link className="underline underline-offset-2" href={`/importacoes/${j.id}`}>Abrir</Link></td>
              </tr>
            ))}</tbody>
          </TableShell>
        )}
        <Pagination base="/importacoes" sp={sp} page={page} total={jobs.total} />
      </Section>
    </>
  );
}
