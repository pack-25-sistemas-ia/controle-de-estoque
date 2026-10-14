import 'server-only';
import type { Context } from '@/lib/auth/session';
import { PAGE_SIZE, safeSearch } from './filters';

// Leituras: sempre pelo cliente do usuário (RLS). Quantidades chegam como number (numeric com até 3 casas; < 2^53); dinheiro em centavos inteiros.

export type InvSettings = { timezone: string; idle_days: number; coverage_window_days: number; label_company_name: boolean; label_show_price: boolean };
export type UnitRow = { id: string; symbol: string; name: string; decimal_places: number; active: boolean };
export type CategoryRow = { id: string; parent_id: string | null; name: string; description: string | null; active: boolean };
export type SupplierRow = { id: string; name: string; legal_name: string | null; document_number: string | null; email: string | null; phone: string | null; lead_time_days: number | null; notes: string | null; active: boolean };
export type WarehouseRow = { id: string; name: string; code: string; description: string | null; address: string | null; active: boolean };
export type LocationRow = { id: string; warehouse_id: string; parent_id: string | null; code: string; name: string; active: boolean };
export type ProductRow = {
  id: string; sku: string; barcode: string | null; name: string; description: string | null; image_path: string | null; list_price_cents: number | null; product_type: string; status: 'active' | 'inactive';
  minimum_stock: number | null; reorder_point: number | null; target_stock: number | null; category_id: string | null; unit_id: string; default_supplier_id: string | null;
  archived_at: string | null; created_at: string;
};
export type StockRow = {
  product_id: string; warehouse_id: string; sku: string; product_name: string; barcode: string | null; category_id: string | null; unit_symbol: string; decimal_places: number;
  product_status: string; warehouse_name: string; warehouse_code: string; quantity_on_hand: number; value_cents: number; average_cost_cents: number | null;
  minimum_quantity: number | null; reorder_point: number | null; target_quantity: number | null; stock_class: 'normal' | 'attention' | 'critical' | 'out_of_stock'; monitored: boolean; archived_at: string | null;
};
export type OperationRow = {
  id: string; org_number: number; operation_type: string; status: 'confirmed' | 'reversed'; reason_code: string | null; warehouse_id: string | null; source_warehouse_id: string | null;
  destination_warehouse_id: string | null; supplier_id: string | null; external_reference: string | null; notes: string | null; count_id: string | null; reversal_of_operation_id: string | null;
  reversal_reason: string | null; created_by: string; occurred_at: string; created_at: string; reversed_at: string | null;
};
export type ItemRow = { id: string; operation_id: string; line_no: number; product_id: string; quantity: number; unit_cost_cents: number | null; cost_policy: string | null; note: string | null };
export type MovementRow = {
  id: string; operation_id: string; product_id: string; warehouse_id: string; movement_type: string; reason_code: string | null; quantity_delta: number; value_delta_cents: number;
  unit_cost_cents: number | null; cost_policy: string | null; balance_after: number; reverses_movement_id: string | null; reason: string | null; performed_by: string; occurred_at: string; created_at: string;
};
export type CountRow = {
  id: string; warehouse_id: string; title: string; status: string; notes: string | null; started_at: string | null; submitted_at: string | null; completed_at: string | null;
  created_by: string; approved_by: string | null; created_at: string;
};
export type CountItemRow = {
  id: string; count_id: string; product_id: string; expected_quantity: number; counted_quantity: number | null; balance_version_at_snapshot: number; counted_by: string | null; note: string | null;
  surplus_unit_cost_cents: number | null; adjustment_operation_id: string | null;
};
export type SuggestionRow = {
  id: string; product_id: string; warehouse_id: string; suggested_quantity: number | null; current_quantity: number; criterion: 'out_of_stock' | 'critical' | 'attention'; status: string; generated_at: string; reviewed_at: string | null;
};
export type NotificationRow = { id: string; type: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string };
export type ImportJobRow = {
  id: string; import_type: string; file_name: string; status: string; total_rows: number; valid_rows: number; duplicate_rows: number; error_rows: number; accepted_rows: number; created_at: string; completed_at: string | null;
};
export type ImportRowRow = { id: string; row_number: number; status: string; parsed_data: Record<string, unknown>; error_message: string | null };
export type AttachmentRow = { id: string; entity_type: string; entity_id: string; original_file_name: string; mime_type: string; size_bytes: number; created_at: string; archived_at: string | null };
export type MemberName = { user_id: string; display_name: string; role: string };

const err = (e: { message: string } | null) => { if (e) throw new Error('consulta falhou'); };
const org = (ctx: Context) => ctx.membership.organization_id;

export async function loadSettings(ctx: Context): Promise<InvSettings> {
  const { data, error } = await ctx.supabase.from('inv_settings').select('timezone, idle_days, coverage_window_days, label_company_name, label_show_price').eq('organization_id', org(ctx)).maybeSingle();
  err(error);
  return (data as InvSettings | null) ?? { timezone: 'America/Sao_Paulo', idle_days: 90, coverage_window_days: 30, label_company_name: true, label_show_price: false };
}

export async function loadUnits(ctx: Context): Promise<UnitRow[]> {
  const { data, error } = await ctx.supabase.from('units_of_measure').select('id, symbol, name, decimal_places, active').eq('organization_id', org(ctx)).order('name');
  err(error);
  return (data ?? []) as UnitRow[];
}
export async function loadCategories(ctx: Context): Promise<CategoryRow[]> {
  const { data, error } = await ctx.supabase.from('product_categories').select('id, parent_id, name, description, active').eq('organization_id', org(ctx)).order('name');
  err(error);
  return (data ?? []) as CategoryRow[];
}
export async function loadSuppliers(ctx: Context, opts: { q?: string; includeInactive?: boolean; page?: number; limit?: number } = {}): Promise<{ rows: SupplierRow[]; total: number }> {
  let q = ctx.supabase.from('suppliers').select('id, name, legal_name, document_number, email, phone, lead_time_days, notes, active', { count: 'exact' }).eq('organization_id', org(ctx)).order('name');
  if (!opts.includeInactive) q = q.eq('active', true);
  const s = safeSearch(opts.q);
  if (s) q = q.or(`name.ilike.%${s}%,legal_name.ilike.%${s}%,email.ilike.%${s}%`);
  const limit = opts.limit ?? 500;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  err(error);
  return { rows: (data ?? []) as SupplierRow[], total: count ?? 0 };
}
export async function loadWarehouses(ctx: Context): Promise<WarehouseRow[]> {
  const { data, error } = await ctx.supabase.from('warehouses').select('id, name, code, description, address, active').eq('organization_id', org(ctx)).order('name');
  err(error);
  return (data ?? []) as WarehouseRow[];
}
export async function loadLocations(ctx: Context, warehouseId: string): Promise<LocationRow[]> {
  const { data, error } = await ctx.supabase.from('warehouse_locations').select('id, warehouse_id, parent_id, code, name, active').eq('organization_id', org(ctx)).eq('warehouse_id', warehouseId).order('code');
  err(error);
  return (data ?? []) as LocationRow[];
}
export async function loadWarehouseAccess(ctx: Context): Promise<Array<{ user_id: string; warehouse_id: string }>> {
  const { data, error } = await ctx.supabase.from('warehouse_access').select('user_id, warehouse_id').eq('organization_id', org(ctx));
  err(error);
  return (data ?? []) as Array<{ user_id: string; warehouse_id: string }>;
}

const PRODUCT_COLS = 'id, sku, barcode, name, description, image_path, list_price_cents, product_type, status, minimum_stock, reorder_point, target_stock, category_id, unit_id, default_supplier_id, archived_at, created_at';
export async function loadProducts(ctx: Context, opts: { q?: string; category?: string[] | null; supplier?: string | null; status?: string | null; archived?: boolean; page?: number; limit?: number; ids?: string[] } = {}): Promise<{ rows: ProductRow[]; total: number }> {
  let q = ctx.supabase.from('products').select(PRODUCT_COLS, { count: 'exact' }).eq('organization_id', org(ctx)).order('name');
  q = opts.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  if (opts.ids) q = q.in('id', opts.ids);
  if (opts.category?.length) q = q.in('category_id', opts.category);
  if (opts.supplier) q = q.eq('default_supplier_id', opts.supplier);
  if (opts.status === 'active' || opts.status === 'inactive') q = q.eq('status', opts.status);
  const s = safeSearch(opts.q);
  if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`);
  const limit = opts.limit ?? PAGE_SIZE;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  err(error);
  return { rows: (data ?? []) as ProductRow[], total: count ?? 0 };
}
export async function loadProduct(ctx: Context, id: string): Promise<ProductRow | null> {
  const { data, error } = await ctx.supabase.from('products').select(PRODUCT_COLS).eq('organization_id', org(ctx)).eq('id', id).maybeSingle();
  err(error);
  return (data as ProductRow | null) ?? null;
}
export async function loadProductSuppliers(ctx: Context, productId: string) {
  const { data, error } = await ctx.supabase.from('product_suppliers').select('id, supplier_id, supplier_sku, last_purchase_cost_cents, lead_time_days, is_preferred').eq('organization_id', org(ctx)).eq('product_id', productId);
  err(error);
  return (data ?? []) as Array<{ id: string; supplier_id: string; supplier_sku: string | null; last_purchase_cost_cents: number | null; lead_time_days: number | null; is_preferred: boolean }>;
}
export async function loadRules(ctx: Context, productId?: string) {
  let q = ctx.supabase.from('reorder_rules').select('id, product_id, warehouse_id, minimum_quantity, reorder_point, target_quantity, lead_time_days, enabled').eq('organization_id', org(ctx));
  if (productId) q = q.eq('product_id', productId);
  const { data, error } = await q;
  err(error);
  return (data ?? []) as Array<{ id: string; product_id: string; warehouse_id: string | null; minimum_quantity: number; reorder_point: number; target_quantity: number | null; lead_time_days: number | null; enabled: boolean }>;
}

const STOCK_COLS = 'product_id, warehouse_id, sku, product_name, barcode, category_id, unit_symbol, decimal_places, product_status, warehouse_name, warehouse_code, quantity_on_hand, value_cents, average_cost_cents, minimum_quantity, reorder_point, target_quantity, stock_class, monitored, archived_at';
export async function loadStock(ctx: Context, opts: { q?: string; warehouse?: string | null; category?: string[] | null; cls?: string | null; productId?: string; withBalance?: boolean; page?: number; limit?: number } = {}): Promise<{ rows: StockRow[]; total: number }> {
  let q = ctx.supabase.from('inv_stock_view').select(STOCK_COLS, { count: 'exact' }).eq('organization_id', org(ctx)).is('archived_at', null).order('product_name').order('warehouse_name');
  if (opts.productId) q = q.eq('product_id', opts.productId);
  if (opts.warehouse) q = q.eq('warehouse_id', opts.warehouse);
  if (opts.category?.length) q = q.in('category_id', opts.category);
  if (opts.cls && ['normal', 'attention', 'critical', 'out_of_stock'].includes(opts.cls)) q = q.eq('stock_class', opts.cls).eq('monitored', true);
  if (opts.withBalance) q = q.gt('quantity_on_hand', 0);
  const s = safeSearch(opts.q);
  if (s) q = q.or(`product_name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`);
  const limit = opts.limit ?? PAGE_SIZE;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  err(error);
  return { rows: (data ?? []) as StockRow[], total: count ?? 0 };
}

export async function loadOperations(ctx: Context, tz: string, opts: { type?: string | null; from?: string; to?: string; warehouse?: string | null; user?: string | null; page?: number; limit?: number; types?: string[] } = {}): Promise<{ rows: OperationRow[]; total: number }> {
  let q = ctx.supabase.from('inv_operations_view').select('id, org_number, operation_type, status, reason_code, warehouse_id, source_warehouse_id, destination_warehouse_id, supplier_id, external_reference, notes, count_id, reversal_of_operation_id, reversal_reason, created_by, occurred_at, created_at, reversed_at', { count: 'exact' })
    .eq('organization_id', org(ctx)).order('occurred_at', { ascending: false }).order('org_number', { ascending: false });
  if (opts.type) q = q.eq('operation_type', opts.type);
  if (opts.types?.length) q = q.in('operation_type', opts.types);
  if (opts.from) q = q.gte('occurred_at', startOfDay(opts.from, tz));
  if (opts.to) q = q.lt('occurred_at', startOfDay(nextDay(opts.to), tz));
  if (opts.warehouse) q = q.or(`warehouse_id.eq.${opts.warehouse},source_warehouse_id.eq.${opts.warehouse},destination_warehouse_id.eq.${opts.warehouse}`);
  if (opts.user) q = q.eq('created_by', opts.user);
  const limit = opts.limit ?? PAGE_SIZE;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  err(error);
  return { rows: (data ?? []) as OperationRow[], total: count ?? 0 };
}
function nextDay(d: string): string { return new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); }
/** Início do dia (00:00) no fuso da empresa, como instante ISO. */
export function startOfDay(date: string, tz: string): string {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(guess - (asLocal - guess)).toISOString();
}

export async function loadOperation(ctx: Context, id: string): Promise<{ op: OperationRow; items: ItemRow[]; movements: MovementRow[] } | null> {
  const [o, i, m] = await Promise.all([
    ctx.supabase.from('inv_operations_view').select('id, org_number, operation_type, status, reason_code, warehouse_id, source_warehouse_id, destination_warehouse_id, supplier_id, external_reference, notes, count_id, reversal_of_operation_id, reversal_reason, created_by, occurred_at, created_at, reversed_at').eq('organization_id', org(ctx)).eq('id', id).maybeSingle(),
    ctx.supabase.from('stock_operation_items').select('id, operation_id, line_no, product_id, quantity, unit_cost_cents, cost_policy, note').eq('organization_id', org(ctx)).eq('operation_id', id).order('line_no'),
    ctx.supabase.from('stock_movements').select('id, operation_id, product_id, warehouse_id, movement_type, reason_code, quantity_delta, value_delta_cents, unit_cost_cents, cost_policy, balance_after, reverses_movement_id, reason, performed_by, occurred_at, created_at').eq('organization_id', org(ctx)).eq('operation_id', id).order('created_at').order('id'),
  ]);
  err(o.error); err(i.error); err(m.error);
  if (!o.data) return null;
  return { op: o.data as OperationRow, items: (i.data ?? []) as ItemRow[], movements: (m.data ?? []) as MovementRow[] };
}

export async function loadMovements(ctx: Context, tz: string, opts: { product?: string | null; warehouse?: string | null; from?: string; to?: string; type?: string | null; user?: string | null; page?: number; limit?: number } = {}): Promise<{ rows: MovementRow[]; total: number }> {
  let q = ctx.supabase.from('stock_movements').select('id, operation_id, product_id, warehouse_id, movement_type, reason_code, quantity_delta, value_delta_cents, unit_cost_cents, cost_policy, balance_after, reverses_movement_id, reason, performed_by, occurred_at, created_at', { count: 'exact' })
    .eq('organization_id', org(ctx)).order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false });
  if (opts.product) q = q.eq('product_id', opts.product);
  if (opts.warehouse) q = q.eq('warehouse_id', opts.warehouse);
  if (opts.type) q = q.eq('movement_type', opts.type);
  if (opts.user) q = q.eq('performed_by', opts.user);
  if (opts.from) q = q.gte('occurred_at', startOfDay(opts.from, tz));
  if (opts.to) q = q.lt('occurred_at', startOfDay(nextDay(opts.to), tz));
  const limit = opts.limit ?? PAGE_SIZE;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  err(error);
  return { rows: (data ?? []) as MovementRow[], total: count ?? 0 };
}

/** Nomes de produtos para listas (uma consulta só). */
export async function productMap(ctx: Context, ids: string[]): Promise<Map<string, { sku: string; name: string; unit: string; decimals: number }>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const [p, u] = await Promise.all([
    ctx.supabase.from('products').select('id, sku, name, unit_id').eq('organization_id', org(ctx)).in('id', uniq.slice(0, 500)),
    loadUnits(ctx),
  ]);
  err(p.error);
  const units = new Map(u.map((x) => [x.id, x]));
  return new Map((p.data ?? []).map((r) => [r.id as string, { sku: r.sku as string, name: r.name as string, unit: units.get(r.unit_id as string)?.symbol ?? '', decimals: units.get(r.unit_id as string)?.decimal_places ?? 0 }]));
}

export async function loadCounts(ctx: Context, opts: { status?: string | null; page?: number } = {}): Promise<{ rows: CountRow[]; total: number }> {
  let q = ctx.supabase.from('physical_counts').select('id, warehouse_id, title, status, notes, started_at, submitted_at, completed_at, created_by, approved_by, created_at', { count: 'exact' }).eq('organization_id', org(ctx)).order('created_at', { ascending: false });
  if (opts.status) q = q.eq('status', opts.status);
  const from = ((opts.page ?? 1) - 1) * PAGE_SIZE;
  const { data, count, error } = await q.range(from, from + PAGE_SIZE - 1);
  err(error);
  return { rows: (data ?? []) as CountRow[], total: count ?? 0 };
}
export async function loadCount(ctx: Context, id: string): Promise<{ count: CountRow; items: CountItemRow[]; currentVersions: Map<string, { version: number; qty: number }> } | null> {
  const [c, i] = await Promise.all([
    ctx.supabase.from('physical_counts').select('id, warehouse_id, title, status, notes, started_at, submitted_at, completed_at, created_by, approved_by, created_at').eq('organization_id', org(ctx)).eq('id', id).maybeSingle(),
    ctx.supabase.from('physical_count_items').select('id, count_id, product_id, expected_quantity, counted_quantity, balance_version_at_snapshot, counted_by, note, surplus_unit_cost_cents, adjustment_operation_id').eq('organization_id', org(ctx)).eq('count_id', id),
  ]);
  err(c.error); err(i.error);
  if (!c.data) return null;
  const items = (i.data ?? []) as CountItemRow[];
  const bal = await ctx.supabase.from('inventory_balances').select('product_id, quantity_on_hand, version').eq('organization_id', org(ctx)).eq('warehouse_id', (c.data as CountRow).warehouse_id).in('product_id', items.map((x) => x.product_id));
  err(bal.error);
  return { count: c.data as CountRow, items, currentVersions: new Map((bal.data ?? []).map((b) => [b.product_id as string, { version: Number(b.version), qty: Number(b.quantity_on_hand) }])) };
}

export async function loadSuggestions(ctx: Context, status = 'pending'): Promise<SuggestionRow[]> {
  const { data, error } = await ctx.supabase.from('replenishment_suggestions').select('id, product_id, warehouse_id, suggested_quantity, current_quantity, criterion, status, generated_at, reviewed_at')
    .eq('organization_id', org(ctx)).eq('status', status).order('generated_at', { ascending: false }).limit(500);
  err(error);
  return (data ?? []) as SuggestionRow[];
}
export async function loadNotifications(ctx: Context, limit = 100): Promise<NotificationRow[]> {
  const { data, error } = await ctx.supabase.from('inv_notifications').select('id, type, title, body, link, read_at, created_at').eq('organization_id', org(ctx)).eq('user_id', ctx.user.id).order('created_at', { ascending: false }).limit(limit);
  err(error);
  return (data ?? []) as NotificationRow[];
}
export async function countUnread(ctx: Context): Promise<number> {
  const { count, error } = await ctx.supabase.from('inv_notifications').select('id', { count: 'exact', head: true }).eq('organization_id', org(ctx)).eq('user_id', ctx.user.id).is('read_at', null);
  err(error);
  return count ?? 0;
}
export async function loadNotificationPrefs(ctx: Context): Promise<Map<string, boolean>> {
  const { data, error } = await ctx.supabase.from('inv_notification_prefs').select('type, enabled').eq('organization_id', org(ctx)).eq('user_id', ctx.user.id);
  err(error);
  return new Map((data ?? []).map((r) => [r.type as string, r.enabled as boolean]));
}
export async function loadImports(ctx: Context, page = 1): Promise<{ rows: ImportJobRow[]; total: number }> {
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await ctx.supabase.from('import_jobs').select('id, import_type, file_name, status, total_rows, valid_rows, duplicate_rows, error_rows, accepted_rows, created_at, completed_at', { count: 'exact' })
    .eq('organization_id', org(ctx)).order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  err(error);
  return { rows: (data ?? []) as ImportJobRow[], total: count ?? 0 };
}
export async function loadImport(ctx: Context, id: string): Promise<{ job: ImportJobRow; rows: ImportRowRow[] } | null> {
  const [j, r] = await Promise.all([
    ctx.supabase.from('import_jobs').select('id, import_type, file_name, status, total_rows, valid_rows, duplicate_rows, error_rows, accepted_rows, created_at, completed_at').eq('organization_id', org(ctx)).eq('id', id).maybeSingle(),
    ctx.supabase.from('import_rows').select('id, row_number, status, parsed_data, error_message').eq('organization_id', org(ctx)).eq('job_id', id).order('row_number').limit(5000),
  ]);
  err(j.error); err(r.error);
  if (!j.data) return null;
  return { job: j.data as ImportJobRow, rows: (r.data ?? []) as ImportRowRow[] };
}
export async function loadAttachments(ctx: Context, type: string, entityId: string): Promise<AttachmentRow[]> {
  const { data, error } = await ctx.supabase.from('attachments').select('id, entity_type, entity_id, original_file_name, mime_type, size_bytes, created_at, archived_at').eq('organization_id', org(ctx)).eq('entity_type', type).eq('entity_id', entityId).is('archived_at', null).order('created_at', { ascending: false });
  err(error);
  return (data ?? []) as AttachmentRow[];
}
export async function loadMemberNames(ctx: Context): Promise<MemberName[]> {
  const { data, error } = await ctx.supabase.rpc('inv_member_names', { p_org: org(ctx) });
  err(error);
  return (data ?? []) as MemberName[];
}

export async function rpc<T>(ctx: Context, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) throw new Error('consulta falhou');
  return data as T;
}

/** Categorias descendentes (a escolhida e todas as filhas) — para o filtro por categoria. */
export function categoryTree(cats: CategoryRow[], id: string | null): string[] | null {
  if (!id) return null;
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) { grew = false; for (const c of cats) if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) { out.add(c.id); grew = true; } }
  return [...out];
}

/** Quantidade de itens por operação (uma consulta para a página inteira). */
export async function loadItemCounts(ctx: Context, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { data, error } = await ctx.supabase.from('stock_operation_items').select('operation_id').eq('organization_id', org(ctx)).in('operation_id', ids);
  err(error);
  for (const r of data ?? []) out.set(r.operation_id as string, (out.get(r.operation_id as string) ?? 0) + 1);
  return out;
}
