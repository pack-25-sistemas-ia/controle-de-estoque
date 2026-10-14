import 'server-only';
import type { Context } from '@/lib/auth/session';
import { rpc } from './data';
import type { Filters } from './filters';

export type UnitQty = { symbol: string; quantity: number; skus?: number };
export type Kpis = {
  period: { from: string; to: string; today: string };
  products_active: number; skus_with_stock: number; units: UnitQty[]; stock_value_cents: number; below_minimum: number; attention: number; out_of_stock: number;
  entries: { operations: number; value_cents: number; by_unit: UnitQty[] };
  issues: { operations: number; cost_cents: number; by_unit: UnitQty[]; other_operations: number; other_cost_cents: number };
  transfers: number; adjustments: { operations: number; abs_value_cents: number }; idle_products: number; idle_days: number; count_divergences: number;
  coverage_days_median: number | null; coverage_products: number; pending_counts: number; pending_suggestions: number;
  recent_operations: Array<{ id: string; number: number; type: string; reason: string | null; warehouse_id: string | null; destination_id: string | null; reference: string | null; user_id: string; at: string; status: string; items: number }>;
};
export type Series = {
  step: 'day' | 'week' | 'month';
  flow: Array<{ period: string; entry_ops: number; issue_ops: number; entry_value_cents: number; issue_value_cents: number }>;
  value_by_category: Array<{ category: string; value_cents: number }>;
  below_minimum: Array<{ product_id: string; sku: string; name: string; warehouse: string; quantity: number; minimum: number | null; reorder_point: number | null; unit: string; class: string }>;
  stock_by_warehouse: Array<{ warehouse: string; code: string; value_cents: number; skus: number }>;
  top_issues: Array<{ product_id: string; sku: string; name: string; cost_cents: number; quantity: number; unit: string }>;
  value_evolution: Array<{ period: string; value_cents: number }>;
  status_distribution: { active: number; inactive: number; archived: number; normal: number; attention: number; critical: number };
  turnover_by_category: Array<{ category: string; cost_cents: number; avg_value_cents: number; turnover: number | null }>;
  count_adjustments: Array<{ period: string; items: number; abs_value_cents: number }>;
  movements_by_type: Array<{ period: string; entry: number; issue: number; transfer: number; adjustment: number; count: number; reversal: number }>;
};
export type ProductStats = {
  quantity: number; value_cents: number; average_cost_cents: number | null;
  by_warehouse: Array<{ warehouse_id: string; name: string; code: string; quantity: number; value_cents: number; minimum: number | null; reorder_point: number | null; target: number | null; class: string }>;
  entries_period: number; issues_period: number; operational_issues_period: number; last_entry_at: string | null; last_issue_at: string | null;
  coverage_days: number | null; coverage_note: string | null; balance_series: Array<{ date: string; quantity: number }>; cost_series: Array<{ date: string; average_cost_cents: number }>;
};
export type TurnoverRow = { product_id: string; sku: string; name: string; unit_symbol: string; category_name: string | null; issued_qty: number; average_stock: number; turnover: number | null; coverage_days: number | null; last_issue_date: string | null; quantity_now: number; history_days: number };
export type IdleRow = { product_id: string; sku: string; name: string; unit_symbol: string; quantity_now: number; value_cents: number; last_issue_date: string | null; days_since_issue: number | null };

const args = (org: string, f: Filters) => ({ p_org: org, p_from: f.from, p_to: f.to, p_warehouse: f.warehouse, p_category: f.category, p_supplier: f.supplier, p_product: f.product, p_user: f.user });

export const loadKpis = (ctx: Context, f: Filters) => rpc<Kpis>(ctx, 'inv_dashboard_kpis', args(ctx.membership.organization_id, f));
export const loadSeries = (ctx: Context, f: Filters) => rpc<Series>(ctx, 'inv_dashboard_series', args(ctx.membership.organization_id, f));
export const loadProductStats = (ctx: Context, productId: string, from: string, to: string) => rpc<ProductStats>(ctx, 'inv_product_stats', { p_org: ctx.membership.organization_id, p_product: productId, p_from: from, p_to: to });
export const loadTurnover = (ctx: Context, f: Filters) =>
  rpc<TurnoverRow[]>(ctx, 'inv_report_turnover', { p_org: ctx.membership.organization_id, p_from: f.from, p_to: f.to, p_warehouse: f.warehouse, p_category: f.category });
export const loadIdle = (ctx: Context, days: number, warehouse: string | null) => rpc<IdleRow[]>(ctx, 'inv_report_idle', { p_org: ctx.membership.organization_id, p_days: days, p_warehouse: warehouse });

/** Rótulo curto de período para eixos: «15/06» (dia/semana) ou «06/2025» (mês). */
export function shortPeriod(iso: string, step: 'day' | 'week' | 'month'): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return step === 'month' ? `${m}/${y}` : `${d}/${m}`;
}
