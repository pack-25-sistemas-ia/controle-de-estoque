import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ClassBadge, Disclosure, Pagination, Qty, TableShell, TD, TDR, TH, THR } from '@/components/inventory/bits';
import { ProductForm } from '@/components/inventory/catalog-forms';
import { ListFilters } from '@/components/inventory/filter-bar';
import { categoryTree, loadProducts } from '@/lib/inventory/data';
import { one, pageFrom, type SearchParams, uuidOrNull } from '@/lib/inventory/filters';
import { categoryOpts, loadRefs, pageCtx, supplierOpts, unitOpts } from '@/lib/inventory/page';
import type { StockClass } from '@/lib/inventory/labels';

export const metadata: Metadata = { title: 'Produtos' };

export default async function ProdutosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const page = pageFrom(one(sp.page));
  const q = one(sp.q);
  const cat = uuidOrNull(one(sp.category));
  const supplier = uuidOrNull(one(sp.supplier));
  const status = one(sp.status) === 'inactive' ? 'inactive' : one(sp.status) === 'active' ? 'active' : null;
  const archived = one(sp.archived) === '1';
  const { rows, total } = await loadProducts(p.ctx, { q, category: categoryTree(refs.categories, cat), supplier, status, archived, page });
  // saldo total e pior situação por produto (uma consulta só)
  const ids = rows.map((r) => r.id);
  const { data: stock } = ids.length ? await p.ctx.supabase.from('inv_stock_view').select('product_id, quantity_on_hand, stock_class, monitored').eq('organization_id', p.org).in('product_id', ids) : { data: [] };
  const sum = new Map<string, { qty: number; cls: StockClass }>();
  const rank: Record<string, number> = { normal: 0, attention: 1, critical: 2, out_of_stock: 3 };
  for (const s of stock ?? []) {
    const e = sum.get(s.product_id as string) ?? { qty: 0, cls: 'normal' as StockClass };
    e.qty += Number(s.quantity_on_hand);
    if (s.monitored && rank[s.stock_class as string]! > rank[e.cls]!) e.cls = s.stock_class as StockClass;
    sum.set(s.product_id as string, e);
  }
  const unit = new Map(refs.units.map((u) => [u.id, u.symbol]));
  const catName = new Map(refs.categories.map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader title="Produtos" description="Cadastro de mercadorias, matérias-primas e insumos. O saldo não é um campo do produto: ele vem do histórico de movimentações." />
      {p.perms.operator ? (
        <div className="mb-6"><Disclosure summary="Cadastrar produto" tone="primary"><ProductForm categories={categoryOpts(refs.categories)} units={unitOpts(refs.units)} suppliers={supplierOpts(refs.suppliers)} canParams={p.perms.manager} /></Disclosure></div>
      ) : null}
      <ListFilters action="/produtos" values={{ q, category: cat ?? '', supplier: supplier ?? '', status: status ?? '', archived: archived ? '1' : '' }}
        fields={[
          { name: 'q', label: 'Buscar (nome, SKU ou código)', width: 'w-64' },
          { name: 'category', label: 'Categoria', options: categoryOpts(refs.categories), all: 'Todas', width: 'w-48' },
          { name: 'supplier', label: 'Fornecedor principal', options: supplierOpts(refs.suppliers), all: 'Todos', width: 'w-48' },
          { name: 'status', label: 'Situação', options: [{ value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }], all: 'Todas', width: 'w-36' },
          { name: 'archived', label: 'Arquivados', options: [{ value: '1', label: 'Mostrar só arquivados' }], all: 'Ocultar', width: 'w-48' },
        ]} />
      {total === 0 && !q && !cat && !supplier && !status && !archived ? (
        <EmptyState title="Nenhum produto cadastrado" description={p.perms.operator ? 'Cadastre o primeiro produto ou importe uma planilha CSV em Importações.' : 'Peça a um operador ou gestor para cadastrar os produtos.'} />
      ) : (
        <TableShell caption="Produtos" empty={rows.length === 0} emptyText="Nenhum produto encontrado com estes filtros.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>SKU</th><th scope="col" className={TH}>Produto</th><th scope="col" className={TH}>Categoria</th><th scope="col" className={TH}>Código de barras</th><th scope="col" className={THR}>Saldo total</th><th scope="col" className={TH}>Reposição</th><th scope="col" className={TH}>Situação</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const s = sum.get(r.id);
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className={TD}><Link className="font-medium underline-offset-2 hover:underline" href={`/produtos/${r.id}`}>{r.sku}</Link></td>
                  <td className={TD}>{r.name}</td>
                  <td className={TD}>{r.category_id ? (catName.get(r.category_id) ?? '—') : '—'}</td>
                  <td className={TD}>{r.barcode ?? '—'}</td>
                  <td className={TDR}><Qty value={s?.qty ?? 0} unit={unit.get(r.unit_id)} /></td>
                  <td className={TD}>{s && s.cls !== 'normal' ? <ClassBadge cls={s.cls} /> : <span className="text-muted">—</span>}</td>
                  <td className={TD}>{r.archived_at ? <Badge>Arquivado</Badge> : r.status === 'inactive' ? <Badge tone="warning">Inativo</Badge> : <Badge tone="success">Ativo</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <Pagination base="/produtos" sp={sp} page={page} total={total} />
    </>
  );
}
