import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { TableShell, TD, TH } from '@/components/inventory/bits';
import { FilterBar } from '@/components/inventory/filter-bar';
import { loadMemberNames } from '@/lib/inventory/data';
import { one, resolveFilters, type SearchParams, withParams } from '@/lib/inventory/filters';
import { buildReport, REPORTS } from '@/lib/inventory/reports';
import { categoryOpts, loadRefs, pageCtx, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Relatórios' };

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const name = one(sp.r);
  const meta = REPORTS.find((r) => r.name === name);
  if (!meta) {
    return (
      <>
        <PageHeader title="Relatórios" description="Todos os relatórios usam os mesmos números do painel, calculados no banco, respeitam o seu perfil e a sua empresa, e podem ser exportados em CSV pela gestão (a exportação fica registrada na auditoria)." />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {REPORTS.map((r) => (
            <li key={r.name}>
              <Link href={`/relatorios?r=${r.name}`} className="block h-full rounded-lg border border-border bg-card p-4 hover:bg-black/5 dark:hover:bg-white/5">
                <p className="font-medium">{r.title}</p><p className="mt-1 text-xs text-muted">{r.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }
  const f = resolveFilters(sp, p.tz);
  const [refs, members] = await Promise.all([loadRefs(p.ctx), loadMemberNames(p.ctx)]);
  const rep = await buildReport(p.ctx, p.tz, meta.name, f);
  const exportHref = withParams(`/api/export/${meta.name}`, sp, { r: null });
  const usesPeriod = ['movimentacoes', 'entradas', 'saidas', 'transferencias', 'ajustes', 'giro', 'cobertura'].includes(meta.name);
  return (
    <>
      <PageHeader title={meta.title} description={rep?.description ?? meta.description}><Link className="text-sm underline underline-offset-2" href="/relatorios">Todos os relatórios</Link></PageHeader>
      <FilterBar action="/relatorios" extra={{ r: meta.name }} filters={f} warehouses={warehouseOpts(refs.warehouses, true)} categories={categoryOpts(refs.categories)} users={usesPeriod ? members.map((m) => ({ value: m.user_id, label: m.display_name })) : undefined} />
      {!usesPeriod ? <p className="mb-3 text-xs text-muted">Este relatório mostra a situação atual do estoque; o período não se aplica.</p> : null}
      {p.perms.manager ? <p className="mb-3 text-sm"><a className="underline underline-offset-2" href={exportHref}>Exportar CSV</a></p> : null}
      {rep?.truncated ? <div className="mb-3"><Alert tone="warning">O relatório foi limitado a 5.000 linhas. Use os filtros para refinar ou exportar por partes.</Alert></div> : null}
      <Card className="p-0">
        <TableShell caption={meta.title} empty={!rep || rep.rows.length === 0} emptyText="Sem dados para os filtros selecionados.">
          <thead><tr className="border-b border-border">{rep?.head.map((h) => <th scope="col" key={h} className={TH}>{h}</th>)}</tr></thead>
          <tbody>{rep?.rows.slice(0, 500).map((row, i) => <tr key={i} className="border-b border-border last:border-0">{row.map((c, j) => <td key={j} className={TD}>{c.d}</td>)}</tr>)}</tbody>
        </TableShell>
      </Card>
      {rep && rep.rows.length > 500 ? <p className="mt-2 text-xs text-muted">Mostrando 500 de {rep.rows.length} linhas; o CSV traz todas.</p> : null}
    </>
  );
}
