import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Disclosure, Money, Section, TableShell, TD, TDR, TH, THR } from '@/components/inventory/bits';
import { AccessForm, LocationForm, RevokeAccessForm, WarehouseForm } from '@/components/inventory/catalog-forms';
import { loadLocations, loadMemberNames, loadWarehouseAccess, loadWarehouses } from '@/lib/inventory/data';
import { one, type SearchParams, uuidOrNull } from '@/lib/inventory/filters';
import { pageCtx, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Depósitos' };

export default async function DepositosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const [warehouses, members, access] = await Promise.all([loadWarehouses(p.ctx), loadMemberNames(p.ctx), p.perms.admin ? loadWarehouseAccess(p.ctx) : Promise.resolve([])]);
  const { data: stock } = await p.ctx.supabase.from('inv_stock_view').select('warehouse_id, quantity_on_hand, value_cents').eq('organization_id', p.org).is('archived_at', null).gt('quantity_on_hand', 0).limit(20000);
  const agg = new Map<string, { skus: number; value: number }>();
  for (const s of stock ?? []) { const e = agg.get(s.warehouse_id as string) ?? { skus: 0, value: 0 }; e.skus++; e.value += Number(s.value_cents); agg.set(s.warehouse_id as string, e); }
  const selId = uuidOrNull(one(sp.w));
  const sel = warehouses.find((w) => w.id === selId);
  const locations = sel ? await loadLocations(p.ctx, sel.id) : [];
  const operators = members.filter((m) => m.role === 'member');
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  const whName = new Map(warehouses.map((w) => [w.id, w.code]));
  return (
    <>
      <PageHeader title="Depósitos" description="Onde o estoque fica guardado. Depósito com saldo ou histórico não é excluído: só arquivado, e só com saldo zero." />
      {p.perms.manager ? <div className="mb-6"><Disclosure summary="Criar depósito" tone="primary"><WarehouseForm /></Disclosure></div> : null}
      {warehouses.length === 0 ? <EmptyState title="Nenhum depósito cadastrado" description="Crie ao menos um depósito para começar a movimentar o estoque." /> : (
        <TableShell caption="Depósitos">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Código</th><th scope="col" className={TH}>Nome</th><th scope="col" className={THR}>SKUs com saldo</th><th scope="col" className={THR}>Valor gerencial</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}><span className="sr-only">Detalhes</span></th></tr></thead>
          <tbody>{warehouses.map((w) => {
            const a = agg.get(w.id);
            return (
              <tr key={w.id} className="border-b border-border last:border-0">
                <td className={`${TD} font-medium`}>{w.code}</td><td className={TD}>{w.name}{w.address ? <span className="block text-xs text-muted">{w.address}</span> : null}</td>
                <td className={TDR}>{a?.skus ?? 0}</td><td className={TDR}><Money cents={a?.value ?? 0} /></td>
                <td className={TD}>{w.active ? <Badge tone="success">Ativo</Badge> : <Badge>Arquivado</Badge>}</td>
                <td className={TD}><span className="flex gap-3"><Link className="underline underline-offset-2" href={`/depositos?w=${w.id}`}>Detalhes</Link><Link className="underline underline-offset-2" href={`/saldos?wh=${w.id}`}>Saldos</Link></span></td>
              </tr>
            );
          })}</tbody>
        </TableShell>
      )}

      {sel ? (
        <Section title={`Depósito ${sel.code} — ${sel.name}`}>
          {p.perms.manager ? <div className="mb-4"><Disclosure summary="Editar depósito"><WarehouseForm warehouse={sel} /></Disclosure></div> : null}
          <h3 className="mb-2 text-base font-semibold">Localizações internas</h3>
          <p className="mb-2 text-xs text-muted">Setores e prateleiras para organizar o depósito. Servem de referência: o saldo continua controlado por depósito.</p>
          {locations.length ? (
            <ul className="mb-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
              {locations.map((l) => <li key={l.id} className="px-3 py-2"><span className="font-medium">{l.code}</span> — {l.name}{l.parent_id ? <span className="ml-2 text-xs text-muted">dentro de {locations.find((x) => x.id === l.parent_id)?.code}</span> : null}</li>)}
            </ul>
          ) : <p className="mb-3 text-sm text-muted">Nenhuma localização cadastrada.</p>}
          {p.perms.manager ? <Disclosure summary="Adicionar localização"><LocationForm warehouseId={sel.id} parents={locations.map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` }))} /></Disclosure> : null}
        </Section>
      ) : null}

      {p.perms.admin ? (
        <Section title="Depósitos autorizados por operador" description="Sem nenhuma autorização, o operador opera em todos os depósitos. Com autorizações, só nos listados. Gestor e administrador não são restringidos.">
          {operators.length === 0 ? <p className="text-sm text-muted">Não há operadores na equipe.</p> : (
            <Card className="space-y-3 p-4">
              {access.length ? (
                <ul className="divide-y divide-border text-sm">
                  {access.map((a) => <li key={`${a.user_id}-${a.warehouse_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{who.get(a.user_id) ?? a.user_id} → {whName.get(a.warehouse_id) ?? '—'}</span><RevokeAccessForm userId={a.user_id} warehouseId={a.warehouse_id} label="acesso" /></li>)}
                </ul>
              ) : <p className="text-sm text-muted">Nenhuma restrição: todos os operadores operam em todos os depósitos.</p>}
              <AccessForm operators={operators.map((o) => ({ value: o.user_id, label: o.display_name }))} warehouses={warehouseOpts(warehouses)} />
            </Card>
          )}
        </Section>
      ) : null}
    </>
  );
}
