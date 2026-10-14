import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Disclosure, Pagination, Section, TableShell, TD, TH } from '@/components/inventory/bits';
import { SupplierForm } from '@/components/inventory/catalog-forms';
import { ListFilters } from '@/components/inventory/filter-bar';
import { loadOperations, loadSuppliers, productMap } from '@/lib/inventory/data';
import { one, pageFrom, type SearchParams, uuidOrNull } from '@/lib/inventory/filters';
import { OP_TYPE_LABELS, REASON_LABELS, type OpType } from '@/lib/inventory/labels';
import { pageCtx } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Fornecedores' };

export default async function FornecedoresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const page = pageFrom(one(sp.page));
  const q = one(sp.q);
  const showInactive = one(sp.inativos) === '1';
  const { rows, total } = await loadSuppliers(p.ctx, { q, includeInactive: showInactive, page, limit: 20 });
  const selId = uuidOrNull(one(sp.s));
  const sel = selId ? rows.find((r) => r.id === selId) ?? (await loadSuppliers(p.ctx, { includeInactive: true, limit: 1000 })).rows.find((r) => r.id === selId) : undefined;
  let linked: Array<{ product_id: string; supplier_sku: string | null; lead_time_days: number | null; is_preferred: boolean }> = [];
  let receipts: Awaited<ReturnType<typeof loadOperations>>['rows'] = [];
  let pm = new Map<string, { sku: string; name: string; unit: string; decimals: number }>();
  if (sel) {
    const { data } = await p.ctx.supabase.from('product_suppliers').select('product_id, supplier_sku, lead_time_days, is_preferred').eq('organization_id', p.org).eq('supplier_id', sel.id).limit(200);
    linked = (data ?? []) as typeof linked;
    pm = await productMap(p.ctx, linked.map((l) => l.product_id));
    const ops = await loadOperations(p.ctx, p.tz, { types: ['entry'], limit: 100 });
    receipts = ops.rows.filter((o) => o.supplier_id === sel.id).slice(0, 10);
  }
  return (
    <>
      <PageHeader title="Fornecedores" description="Quem abastece o seu estoque. O prazo de entrega é o informado por você; o sistema não calcula nota de desempenho do fornecedor." />
      {p.perms.manager ? <div className="mb-6"><Disclosure summary="Cadastrar fornecedor" tone="primary"><SupplierForm /></Disclosure></div> : null}
      <ListFilters action="/fornecedores" values={{ q, inativos: showInactive ? '1' : '' }}
        fields={[{ name: 'q', label: 'Buscar (nome, razão social ou e-mail)', width: 'w-72' }, { name: 'inativos', label: 'Inativos', options: [{ value: '1', label: 'Incluir inativos' }], all: 'Ocultar', width: 'w-44' }]} />
      {total === 0 && !q ? <EmptyState title="Nenhum fornecedor cadastrado" description={p.perms.manager ? 'Cadastre os fornecedores ou importe um CSV em Importações.' : 'Peça ao gestor para cadastrar os fornecedores.'} /> : (
        <TableShell caption="Fornecedores" empty={rows.length === 0} emptyText="Nenhum fornecedor encontrado.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Nome</th><th scope="col" className={TH}>Contato</th><th scope="col" className={TH}>Prazo</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}><span className="sr-only">Detalhes</span></th></tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id} className="border-b border-border last:border-0">
              <td className={TD}>{s.name}{s.legal_name ? <span className="block text-xs text-muted">{s.legal_name}</span> : null}</td>
              <td className={TD}>{s.email ?? '—'}{s.phone ? <span className="block text-xs text-muted">{s.phone}</span> : null}</td>
              <td className={TD}>{s.lead_time_days === null ? '—' : `${s.lead_time_days} dia(s)`}</td>
              <td className={TD}>{s.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
              <td className={TD}><Link className="underline underline-offset-2" href={`/fornecedores?s=${s.id}`}>Detalhes</Link></td>
            </tr>
          ))}</tbody>
        </TableShell>
      )}
      <Pagination base="/fornecedores" sp={sp} page={page} total={total} size={20} />

      {sel ? (
        <Section title={`Fornecedor: ${sel.name}`}>
          <Card className="mb-4 p-4 text-sm">
            <p>{sel.notes ?? 'Sem observações.'}</p>
            <p className="mt-2 text-muted">Prazo de entrega informado: {sel.lead_time_days === null ? 'não informado' : `${sel.lead_time_days} dia(s)`}.</p>
          </Card>
          <h3 className="mb-2 text-base font-semibold">Produtos fornecidos</h3>
          {linked.length ? (
            <ul className="mb-4 divide-y divide-border rounded-lg border border-border bg-card text-sm">
              {linked.map((l) => <li key={l.product_id} className="px-3 py-2"><Link className="underline" href={`/produtos/${l.product_id}`}>{pm.get(l.product_id)?.sku}</Link> — {pm.get(l.product_id)?.name}{l.is_preferred ? <Badge tone="success"> preferencial</Badge> : null}<span className="ml-2 text-xs text-muted">{l.supplier_sku ? `SKU no fornecedor ${l.supplier_sku}` : ''}</span></li>)}
            </ul>
          ) : <p className="mb-4 text-sm text-muted">Nenhum produto associado (associe na página do produto).</p>}
          <h3 className="mb-2 text-base font-semibold">Últimos recebimentos</h3>
          {receipts.length ? (
            <ul className="mb-4 divide-y divide-border rounded-lg border border-border bg-card text-sm">
              {receipts.map((o) => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span>{OP_TYPE_LABELS[o.operation_type as OpType]} nº {o.org_number} · {o.reason_code ? REASON_LABELS[o.reason_code] : ''}</span><span className="flex items-center gap-3"><DateTimeBR value={o.occurred_at} tz={p.tz} /><Link className="underline" href={`/movimentacoes/${o.id}`}>Abrir</Link></span></li>)}
            </ul>
          ) : <p className="mb-4 text-sm text-muted">Nenhuma entrada vinculada a este fornecedor.</p>}
          {p.perms.manager ? <Disclosure summary="Editar fornecedor"><SupplierForm supplier={sel} /></Disclosure> : null}
        </Section>
      ) : null}
    </>
  );
}
