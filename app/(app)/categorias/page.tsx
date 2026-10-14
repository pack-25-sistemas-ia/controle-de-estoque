import type { Metadata } from 'next';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { Disclosure, Section } from '@/components/inventory/bits';
import { CategoryForm, CategoryRowForm } from '@/components/inventory/catalog-forms';
import { categoryOpts, loadRefs, pageCtx, categoryLabel } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Categorias' };

export default async function CategoriasPage() {
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const sorted = [...refs.categories].sort((a, b) => categoryLabel(refs.categories, a).localeCompare(categoryLabel(refs.categories, b), 'pt-BR'));
  return (
    <>
      <PageHeader title="Categorias de produtos" description="Organize os produtos em categorias e subcategorias (até 4 níveis). Desativar uma categoria não altera os produtos nem o histórico." />
      {p.perms.manager ? <div className="mb-6"><Disclosure summary="Nova categoria" tone="primary"><CategoryForm parents={categoryOpts(refs.categories)} /></Disclosure></div> : null}
      <Section title={`Categorias (${sorted.length})`}>
        {sorted.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhuma categoria cadastrada.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {sorted.map((c) => (
              <li key={c.id} className="px-3 py-3">
                {p.perms.manager ? (
                  <div className="space-y-1"><p className="text-xs text-muted">{categoryLabel(refs.categories, c)}</p><CategoryRowForm id={c.id} name={c.name} description={c.description} active={c.active} /></div>
                ) : (
                  <div className="flex items-center justify-between gap-2 text-sm"><span>{categoryLabel(refs.categories, c)}</span>{c.active ? null : <Badge>Inativa</Badge>}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
