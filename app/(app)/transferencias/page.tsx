import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { Disclosure, Pagination, Section } from '@/components/inventory/bits';
import { TransferForm } from '@/components/inventory/operation-forms';
import { OperationsTable } from '@/components/inventory/pages/operations-table';
import { loadItemCounts, loadMemberNames, loadOperations } from '@/lib/inventory/data';
import { one, pageFrom, type SearchParams } from '@/lib/inventory/filters';
import { loadRefs, pageCtx, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Transferências' };

export default async function TransferenciasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const page = pageFrom(one(sp.page));
  const [ops, members] = await Promise.all([loadOperations(p.ctx, p.tz, { types: ['transfer'], page }), loadMemberNames(p.ctx)]);
  const counts = await loadItemCounts(p.ctx, ops.rows.map((o) => o.id));
  const whs = warehouseOpts(refs.warehouses);
  return (
    <>
      <PageHeader title="Transferências entre depósitos" description="Move mercadoria de um depósito para outro em uma única operação: sai de um lado e entra do outro juntos, ou nada acontece. O total de unidades e o valor do estoque não mudam." />
      {p.perms.operator ? (
        whs.length < 2 ? (
          <EmptyState title="São necessários dois depósitos" description="Cadastre ao menos dois depósitos ativos para transferir.">{p.perms.manager ? <Link className="underline" href="/depositos">Ir para depósitos</Link> : null}</EmptyState>
        ) : (
          <div className="mb-6"><Disclosure summary="Registrar transferência" open tone="primary"><TransferForm warehouses={whs} today={p.today} /></Disclosure></div>
        )
      ) : null}
      <Section title="Últimas transferências">
        <OperationsTable rows={ops.rows} warehouses={refs.warehouses} members={members} tz={p.tz} itemCounts={counts} />
        <Pagination base="/transferencias" sp={sp} page={page} total={ops.total} />
      </Section>
    </>
  );
}
