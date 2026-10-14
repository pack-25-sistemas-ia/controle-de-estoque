import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { Disclosure, Pagination, Section } from '@/components/inventory/bits';
import { IssueForm } from '@/components/inventory/operation-forms';
import { OperationsTable } from '@/components/inventory/pages/operations-table';
import { loadItemCounts, loadMemberNames, loadOperations } from '@/lib/inventory/data';
import { one, pageFrom, type SearchParams } from '@/lib/inventory/filters';
import { loadRefs, pageCtx, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Saídas' };

export default async function SaidasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const page = pageFrom(one(sp.page));
  const [ops, members] = await Promise.all([loadOperations(p.ctx, p.tz, { types: ['issue'], page }), loadMemberNames(p.ctx)]);
  const counts = await loadItemCounts(p.ctx, ops.rows.map((o) => o.id));
  const whs = warehouseOpts(refs.warehouses);
  return (
    <>
      <PageHeader title="Saídas de estoque" description="Vendas, consumo interno, perdas, avarias e demais retiradas. O sistema não deixa o saldo ficar negativo e registra o custo médio vigente no momento da saída." />
      {p.perms.operator ? (
        whs.length === 0 ? (
          <EmptyState title="Cadastre um depósito primeiro" description="Toda movimentação acontece em um depósito.">{p.perms.manager ? <Link className="underline" href="/depositos">Ir para depósitos</Link> : null}</EmptyState>
        ) : (
          <div className="mb-6"><Disclosure summary="Registrar saída" open tone="primary"><IssueForm warehouses={whs} today={p.today} /></Disclosure></div>
        )
      ) : null}
      <Section title="Últimas saídas">
        <OperationsTable rows={ops.rows} warehouses={refs.warehouses} members={members} tz={p.tz} itemCounts={counts} />
        <Pagination base="/saidas" sp={sp} page={page} total={ops.total} />
      </Section>
    </>
  );
}
