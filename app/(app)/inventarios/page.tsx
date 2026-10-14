import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Disclosure, Pagination, Section, TableShell, TD, TH } from '@/components/inventory/bits';
import { CreateCountForm } from '@/components/inventory/count-forms';
import { loadCounts, loadMemberNames, loadWarehouses } from '@/lib/inventory/data';
import { one, pageFrom, type SearchParams } from '@/lib/inventory/filters';
import { COUNT_STATUS_LABELS, COUNT_STATUS_TONES } from '@/lib/inventory/labels';
import { pageCtx, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Inventário físico' };

export default async function InventariosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const page = pageFrom(one(sp.page));
  const [counts, warehouses, members] = await Promise.all([loadCounts(p.ctx, { page }), loadWarehouses(p.ctx), loadMemberNames(p.ctx)]);
  const whName = new Map(warehouses.map((w) => [w.id, `${w.code} · ${w.name}`]));
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  return (
    <>
      <PageHeader title="Inventário físico" description="Conferência do estoque real. O sistema congela a quantidade esperada e a versão do saldo no início; a aprovação gera ajustes no histórico. Se o saldo mudar durante a contagem, é preciso recontar o item." />
      {p.perms.operator ? (
        <div className="mb-6"><Disclosure summary="Iniciar inventário" tone="primary"><CreateCountForm warehouses={warehouseOpts(warehouses)} /></Disclosure></div>
      ) : null}
      <Section title="Inventários">
        {counts.total === 0 ? <EmptyState title="Nenhum inventário realizado" description="Inicie um inventário para comparar o estoque contado com o do sistema." /> : (
          <TableShell caption="Inventários">
            <thead><tr className="border-b border-border"><th scope="col" className={TH}>Título</th><th scope="col" className={TH}>Depósito</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Início</th><th scope="col" className={TH}>Responsável</th><th scope="col" className={TH}><span className="sr-only">Abrir</span></th></tr></thead>
            <tbody>{counts.rows.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className={`${TD} font-medium`}>{c.title}</td><td className={TD}>{whName.get(c.warehouse_id) ?? '—'}</td>
                <td className={TD}><Badge tone={COUNT_STATUS_TONES[c.status] ?? 'neutral'}>{COUNT_STATUS_LABELS[c.status] ?? c.status}</Badge></td>
                <td className={TD}><DateTimeBR value={c.started_at ?? c.created_at} tz={p.tz} /></td><td className={TD}>{who.get(c.created_by) ?? '—'}</td>
                <td className={TD}><Link className="underline underline-offset-2" href={`/inventarios/${c.id}`}>Abrir</Link></td>
              </tr>
            ))}</tbody>
          </TableShell>
        )}
        <Pagination base="/inventarios" sp={sp} page={page} total={counts.total} />
      </Section>
    </>
  );
}
