'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import type { Context } from '@/lib/auth/session';
import { bustInventory, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { instantOnDate } from '../dates';
import { productMap } from '../data';
import { loadSettings } from '../data';
import { adjustmentSchema, entrySchema, issueSchema, openingSchema, reverseSchema, transferSchema, type Line } from '../schemas';
import { parseQty, parseUnitCostCents } from '../qty';

type Mode = 'entry' | 'issue' | 'transfer' | 'adjust_in' | 'adjust_out' | 'opening';

/**
 * Converte as linhas digitadas (texto) no JSON do banco. A escala da unidade e o custo são normalizados aqui para dar mensagem clara por linha;
 * o banco confere tudo de novo (escala, saldo, custo, produto ativo, empresa).
 */
async function buildItems(ctx: Context, lines: Line[], mode: Mode, reason?: string): Promise<{ items: unknown[] } | { error: string }> {
  const pm = await productMap(ctx, lines.map((l) => l.product_id));
  const items: unknown[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const p = pm.get(l.product_id);
    const tag = `Item ${i + 1}${p ? ` (${p.sku})` : ''}`;
    if (!p) return { error: `${tag}: produto não encontrado.` };
    const qty = parseQty(l.quantity, p.decimals);
    if (qty === null) return { error: `${tag}: quantidade inválida${p.decimals === 0 ? ' — esta unidade só aceita números inteiros' : ` — use até ${p.decimals} casa(s) decimal(is)`} e maior que zero.` };
    const item: Record<string, unknown> = { product_id: l.product_id, quantity: qty };
    if (mode === 'entry' || mode === 'adjust_in' || mode === 'opening') {
      const m = l.cost_mode ?? (mode === 'opening' || reason === 'purchase' ? 'informed' : l.reference_movement_id ? 'original' : 'average');
      item.cost_mode = m;
      if (m === 'informed') {
        const c = parseUnitCostCents(l.cost);
        if (c === null) return { error: `${tag}: informe o custo unitário em reais (ex.: 12,34).` };
        item.unit_cost = c;
      }
      if (m === 'original') {
        if (!l.reference_movement_id) return { error: `${tag}: informe a saída de origem da devolução.` };
        item.reference_movement_id = l.reference_movement_id;
      }
    }
    items.push(item);
  }
  return { items };
}

const when = async (ctx: Context, d: string | null) => (d ? instantOnDate(d, (await loadSettings(ctx)).timezone) : null);
const done = (id: string, msg: string): SaveResult => ({ ...succeed(msg), id, redirectTo: `/movimentacoes/${id}` });

export async function postEntry(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(entrySchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'postEntry', async (ctx, org) => {
    const v = p.data;
    const b = await buildItems(ctx, v.items, 'entry', v.reason);
    if ('error' in b) return fail(b.error, undefined, raw);
    const { data, error } = await ctx.supabase.rpc('inv_post_entry', { p_org: org, p_warehouse: v.warehouse_id, p_reason: v.reason, p_items: b.items, p_supplier: v.supplier_id, p_external_ref: v.external_reference, p_notes: v.notes, p_at: await when(ctx, v.occurred_on), p_key: v.idem });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return done(data as string, 'Entrada registrada.');
  });
}

export async function postIssue(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(issueSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'postIssue', async (ctx, org) => {
    const v = p.data;
    const b = await buildItems(ctx, v.items, 'issue');
    if ('error' in b) return fail(b.error, undefined, raw);
    const { data, error } = await ctx.supabase.rpc('inv_post_issue', { p_org: org, p_warehouse: v.warehouse_id, p_reason: v.reason, p_items: b.items, p_external_ref: v.external_reference, p_notes: v.notes, p_at: await when(ctx, v.occurred_on), p_key: v.idem });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return done(data as string, 'Saída registrada.');
  });
}

export async function postTransfer(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(transferSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'postTransfer', async (ctx, org) => {
    const v = p.data;
    const b = await buildItems(ctx, v.items, 'transfer');
    if ('error' in b) return fail(b.error, undefined, raw);
    const { data, error } = await ctx.supabase.rpc('inv_post_transfer', { p_org: org, p_source: v.source_id, p_destination: v.destination_id, p_items: b.items, p_notes: v.notes, p_at: await when(ctx, v.occurred_on), p_key: v.idem });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return done(data as string, 'Transferência registrada.');
  });
}

export async function postAdjustment(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(adjustmentSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'postAdjustment', async (ctx, org) => {
    const v = p.data;
    const b = await buildItems(ctx, v.items, v.direction === 'in' ? 'adjust_in' : 'adjust_out', v.reason);
    if ('error' in b) return fail(b.error, undefined, raw);
    const { data, error } = await ctx.supabase.rpc('inv_post_adjustment', { p_org: org, p_warehouse: v.warehouse_id, p_direction: v.direction, p_reason: v.reason, p_justification: v.justification, p_items: b.items, p_at: await when(ctx, v.occurred_on), p_key: v.idem });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return done(data as string, 'Ajuste registrado.');
  });
}

export async function postOpening(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(openingSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'postOpening', async (ctx, org) => {
    const v = p.data;
    const b = await buildItems(ctx, v.items, 'opening');
    if ('error' in b) return fail(b.error, undefined, raw);
    const { data, error } = await ctx.supabase.rpc('inv_post_opening', { p_org: org, p_warehouse: v.warehouse_id, p_items: b.items, p_at: await when(ctx, v.occurred_on), p_key: v.idem });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return done(data as string, 'Saldo inicial lançado.');
  });
}

export async function reverseOperation(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(reverseSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'reverseOperation', async (ctx) => {
    const v = p.data;
    const { data, error } = await ctx.supabase.rpc('inv_reverse_operation', { p_operation: v.id, p_reason: v.reason, p_key: v.idem });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return done(data as string, 'Operação estornada: os movimentos compensatórios foram registrados.');
  });
}
