import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, EmptyState, PageHeader } from '@/components/ui/primitives';
import { LabelSheet } from '@/components/inventory/label-sheet';
import { ListFilters } from '@/components/inventory/filter-bar';
import { loadProducts } from '@/lib/inventory/data';
import { one, type SearchParams, uuidOrNull } from '@/lib/inventory/filters';
import { pageCtx } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Etiquetas' };

export default async function EtiquetasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const single = uuidOrNull(one(sp.p));
  const q = one(sp.q);
  const copies = Math.min(Math.max(Number(one(sp.n)) || 1, 1), 100);
  const { rows } = single ? await loadProducts(p.ctx, { ids: [single], limit: 1 }) : q ? await loadProducts(p.ctx, { q, status: 'active', limit: 40 }) : { rows: [] };
  const { data: org } = await p.ctx.supabase.from('organizations').select('name').eq('id', p.org).maybeSingle();
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Etiquetas de produtos" description="Gere e imprima etiquetas com nome, SKU e código de barras. O código impresso é o do cadastro: o sistema não registra GTIN em nenhum órgão. Para produtos sem código, gere um código interno no cadastro." />
        <ListFilters action="/etiquetas" values={{ q, n: String(copies) }} fields={[{ name: 'q', label: 'Buscar produtos (nome, SKU ou código)', width: 'w-72' }, { name: 'n', label: 'Cópias de cada', type: 'text', width: 'w-24' }]} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={single || q ? 'Nenhum produto encontrado' : 'Busque os produtos que quer etiquetar'} description="Digite o nome, o SKU ou o código de barras. Você também chega aqui pela página de cada produto.">
          <Link className="underline" href="/produtos">Ver produtos</Link>
        </EmptyState>
      ) : (
        <>
          {rows.some((r) => !r.barcode) ? <div className="mb-4 print:hidden"><Alert tone="warning">Há produtos sem código de barras: a etiqueta sai só com nome e SKU. Cadastre um código (ou gere um interno) na página do produto.</Alert></div> : null}
          <LabelSheet items={rows.map((r) => ({ sku: r.sku, name: r.name, barcode: r.barcode, priceCents: r.list_price_cents, copies }))}
            company={(org?.name as string | undefined) ?? ''} showCompany={p.settings.label_company_name} showPrice={p.settings.label_show_price} />
        </>
      )}
    </>
  );
}
