import 'server-only';
import { requireContext } from '@/lib/auth/session';
import { loadCategories, loadSettings, loadSuppliers, loadUnits, loadWarehouses, type CategoryRow, type SupplierRow, type UnitRow, type WarehouseRow } from './data';
import { todayIn } from './dates';
import { can } from './labels';

/** Contexto comum das páginas: sessão (já com MFA/papel), fuso da empresa, «hoje» e permissões para mostrar/ocultar botões (o banco decide de verdade). */
export async function pageCtx() {
  const ctx = await requireContext();
  const settings = await loadSettings(ctx);
  return { ctx, settings, tz: settings.timezone, today: todayIn(settings.timezone), perms: can(ctx.membership.role), org: ctx.membership.organization_id, role: ctx.membership.role };
}
export type PageCtx = Awaited<ReturnType<typeof pageCtx>>;

export type Refs = { warehouses: WarehouseRow[]; units: UnitRow[]; categories: CategoryRow[]; suppliers: SupplierRow[] };
export async function loadRefs(ctx: PageCtx['ctx']): Promise<Refs> {
  const [warehouses, units, categories, sup] = await Promise.all([loadWarehouses(ctx), loadUnits(ctx), loadCategories(ctx), loadSuppliers(ctx, { includeInactive: true, limit: 1000 })]);
  return { warehouses, units, categories, suppliers: sup.rows };
}

/** «Pai › Filho» para listas de seleção. */
export function categoryLabel(cats: CategoryRow[], c: CategoryRow): string {
  const byId = new Map(cats.map((x) => [x.id, x]));
  const parts = [c.name];
  let cur = c.parent_id ? byId.get(c.parent_id) : undefined;
  let guard = 0;
  while (cur && guard++ < 5) { parts.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return parts.join(' › ');
}

export const warehouseOpts = (w: WarehouseRow[], includeInactive = false) => w.filter((x) => includeInactive || x.active).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }));
export const categoryOpts = (cats: CategoryRow[]) => cats.filter((c) => c.active).map((c) => ({ value: c.id, label: categoryLabel(cats, c) })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
export const supplierOpts = (s: SupplierRow[]) => s.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name }));
export const unitOpts = (u: UnitRow[]) => u.filter((x) => x.active).map((x) => ({ value: x.id, label: `${x.name} (${x.symbol})` }));
