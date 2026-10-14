import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { Disclosure, Pagination, Section } from '@/components/inventory/bits';
import { EntryForm, OpeningForm } from '@/components/inventory/operation-forms';
import { OperationsTable } from '@/components/inventory/pages/operations-table';
import { loadItemCounts, loadMemberNames, loadOperations } from '@/lib/inventory/data';
import { one, pageFrom, type SearchParams } from '@/lib/inventory/filters';
import { loadRefs, pageCtx, supplierOpts, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Entradas' };

export default async function EntradasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const page = pageFrom(one(sp.page));
  const [ops, members] = await Promise.all([loadOperations(p.ctx, p.tz, { types: ['entry', 'opening'], page }), loadMemberNames(p.ctx)]);
  const counts = await loadItemCounts(p.ctx, ops.rows.map((o) => o.id));
  const whs = warehouseOpts(refs.warehouses);
  return (
    <>
      <PageHeader title="Entradas de estoque" description="Compras, devoluções de clientes, saldo inicial e outras entradas. Cada entrada soma ao saldo do depósito e atualiza o custo médio; nada é editado depois de confirmado (use o estorno)." />
      {p.perms.operator ? (
        whs.length === 0 ? (
          <EmptyState title="Cadastre um depósito primeiro" description="Toda movimentação acontece em um depósito.">{p.perms.manager ? <Link className="underline" href="/depositos">Ir para depósitos</Link> : null}</EmptyState>
        ) : (
          <div className="mb-6 space-y-3">
            <Disclosure summary="Registrar entrada" open tone="primary"><EntryForm warehouses={whs} suppliers={supplierOpts(refs.suppliers)} today={p.today} /></Disclosure>
            {p.perms.manager ? <Disclosure summary="Lançar saldo inicial (abertura)"><OpeningForm warehouses={whs} today={p.today} /></Disclosure> : null}
          </div>
        )
      ) : null}
      <Section title="Últimas entradas" description="Veja também a importação de saldo inicial em Importações.">
        <OperationsTable rows={ops.rows} warehouses={refs.warehouses} members={members} tz={p.tz} itemCounts={counts} />
        <Pagination base="/entradas" sp={sp} page={page} total={ops.total} />
      </Section>
    </>
  );
}
