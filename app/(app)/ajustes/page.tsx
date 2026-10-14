import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Disclosure, Pagination, Section } from '@/components/inventory/bits';
import { AdjustmentForm } from '@/components/inventory/operation-forms';
import { OperationsTable } from '@/components/inventory/pages/operations-table';
import { loadItemCounts, loadMemberNames, loadOperations } from '@/lib/inventory/data';
import { one, pageFrom, type SearchParams } from '@/lib/inventory/filters';
import { loadRefs, pageCtx, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Ajustes' };

export default async function AjustesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const page = pageFrom(one(sp.page));
  const [ops, members] = await Promise.all([loadOperations(p.ctx, p.tz, { types: ['adjustment', 'count_adjustment'], page }), loadMemberNames(p.ctx)]);
  const counts = await loadItemCounts(p.ctx, ops.rows.map((o) => o.id));
  const whs = warehouseOpts(refs.warehouses);
  return (
    <>
      <PageHeader title="Ajustes de estoque" description="Correções justificadas do saldo (avaria, perda, erro operacional, divergência). Todo ajuste é um movimento no histórico, com o seu nome, o motivo e o custo usado. O saldo nunca é editado diretamente." />
      {!p.perms.manager ? <div className="mb-6"><Alert tone="info">Ajustes de saldo são feitos pelo gestor de estoque ou administrador. Operadores registram entradas, saídas, transferências e contagens de inventário.</Alert></div> : null}
      {p.perms.manager ? (
        whs.length === 0 ? (
          <EmptyState title="Cadastre um depósito primeiro" description="Toda movimentação acontece em um depósito."><Link className="underline" href="/depositos">Ir para depósitos</Link></EmptyState>
        ) : (
          <div className="mb-6"><Disclosure summary="Registrar ajuste" open tone="primary"><AdjustmentForm warehouses={whs} today={p.today} /></Disclosure></div>
        )
      ) : null}
      <Section title="Últimos ajustes" description="Inclui os ajustes gerados pela aprovação de inventários.">
        <OperationsTable rows={ops.rows} warehouses={refs.warehouses} members={members} tz={p.tz} itemCounts={counts} />
        <Pagination base="/ajustes" sp={sp} page={page} total={ops.total} />
      </Section>
    </>
  );
}
