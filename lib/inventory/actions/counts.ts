'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bust, bustInventory, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { productMap } from '../data';
import { parseQty, parseUnitCostCents } from '../qty';
import { countAddProductSchema, countCancelSchema, countCreateSchema, countIdSchema, countRecordSchema, notificationPrefSchema, suggestionReviewSchema, surplusCostSchema } from '../schemas';
import { NOTIFICATION_TYPES } from '../labels';
import { z } from 'zod';

// Inventário físico e reposição: toda a regra (snapshot, versão do saldo, ajuste ao custo médio) está nas funções inv_* do banco.

export async function createCount(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(countCreateSchema, raw, raw);
  if (!p.ok) return p.state;
  const skus = [...new Set((p.data.skus ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  if (skus.length > 500) return fail('Informe no máximo 500 SKUs (ou deixe vazio para contar todos os produtos com saldo).', undefined, raw);
  return guarded('operator', 'createCount', async (ctx, org) => {
    const v = p.data;
    let ids: string[] = [];
    if (skus.length) {
      const { data: found, error: e1 } = await ctx.supabase.from('products').select('id, sku').eq('organization_id', org).is('archived_at', null).in('sku', skus.flatMap((s) => [s, s.toUpperCase()]));
      if (e1) return fail(dbMessage(e1), undefined, raw);
      const byLower = new Map((found ?? []).map((x) => [String(x.sku).toLowerCase(), x.id as string]));
      const missing = skus.filter((s) => !byLower.has(s.toLowerCase()));
      if (missing.length) return fail(`SKU não encontrado: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}.`, { skus: ['Há SKUs inexistentes.'] }, raw);
      ids = [...new Set(skus.map((s) => byLower.get(s.toLowerCase())!))];
    }
    const { data, error } = await ctx.supabase.rpc('inv_create_count', { p_org: org, p_warehouse: v.warehouse_id, p_title: v.title, p_products: ids.length ? ids : null, p_notes: v.notes });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return { ...succeed('Inventário iniciado: as quantidades esperadas foram congeladas neste momento.'), id: data as string, redirectTo: `/inventarios/${data as string}` };
  });
}

export async function recordCount(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(countRecordSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'recordCount', async (ctx, org) => {
    const v = p.data;
    const { data: it, error: e0 } = await ctx.supabase.from('physical_count_items').select('product_id').eq('organization_id', org).eq('id', v.item_id).maybeSingle();
    if (e0 || !it) return fail('Item de inventário não encontrado.', undefined, raw);
    const pm = await productMap(ctx, [it.product_id as string]);
    const prod = pm.get(it.product_id as string);
    const q = prod ? parseQty(v.counted, prod.decimals, { allowZero: true }) : null;
    if (q === null) return fail(`Quantidade contada inválida${prod ? (prod.decimals === 0 ? ' — esta unidade só aceita números inteiros' : ` — use até ${prod.decimals} casa(s) decimal(is)`) : ''}.`, { counted: ['Quantidade inválida.'] }, raw);
    const { error } = await ctx.supabase.rpc('inv_count_record', { p_item: v.item_id, p_counted: q, p_note: v.note });
    if (error) return fail(dbMessage(error), undefined, raw);
    bust('/inventarios');
    return succeed('Contagem registrada.');
  });
}

export async function addCountProduct(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(countAddProductSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'addCountProduct', async (ctx) => {
    const { error } = await ctx.supabase.rpc('inv_count_add_product', { p_count: p.data.id, p_product: p.data.product_id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bust('/inventarios');
    return succeed('Produto incluído na contagem.');
  });
}

async function simple(name: string, level: 'operator' | 'manager', fn: string, argName: string, fd: FormData, ok: string): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(countIdSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded(level, name, async (ctx) => {
    const { error } = await ctx.supabase.rpc(fn, { [argName]: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return succeed(ok);
  });
}
export const submitCount = async (_: ActionState, fd: FormData) => simple('submitCount', 'operator', 'inv_submit_count', 'p_count', fd, 'Enviado para aprovação.');
export const reopenCount = async (_: ActionState, fd: FormData) => simple('reopenCount', 'manager', 'inv_reopen_stale_count', 'p_count', fd, 'Inventário reaberto: os itens com saldo alterado precisam ser contados de novo.');

export async function approveCount(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(countIdSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'approveCount', async (ctx) => {
    const { error } = await ctx.supabase.rpc('inv_approve_count', { p_count: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return succeed('Inventário aprovado: as diferenças viraram ajustes no histórico.');
  });
}

export async function cancelCount(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(countCancelSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'cancelCount', async (ctx) => {
    const { error } = await ctx.supabase.rpc('inv_cancel_count', { p_count: p.data.id, p_reason: p.data.reason });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return succeed('Inventário cancelado.');
  });
}

export async function setSurplusCost(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(surplusCostSchema, raw, raw);
  if (!p.ok) return p.state;
  const cents = p.data.cost === '' ? null : parseUnitCostCents(p.data.cost);
  if (p.data.cost !== '' && cents === null) return fail('Custo inválido. Use o formato 12,34.', { cost: ['Custo inválido.'] }, raw);
  return guarded('manager', 'setSurplusCost', async (ctx) => {
    const { error } = await ctx.supabase.rpc('inv_count_set_surplus_cost', { p_item: p.data.item_id, p_unit_cost: cents });
    if (error) return fail(dbMessage(error), undefined, raw);
    bust('/inventarios');
    return succeed('Custo da sobra registrado.');
  });
}

export async function runRoutines(): Promise<ActionState> {
  return guarded('operator', 'runRoutines', async (ctx, org) => {
    const { data, error } = await ctx.supabase.rpc('inv_run_routines', { p_org: org });
    if (error) return fail(dbMessage(error));
    bustInventory();
    const r = data as { suggestions: number; notifications: number };
    return succeed(`Rotinas executadas: ${r.suggestions} sugestão(ões) nova(s) e ${r.notifications} aviso(s).`);
  });
}

export async function reviewSuggestion(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(suggestionReviewSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'reviewSuggestion', async (ctx) => {
    const v = p.data;
    let qty: string | null = null;
    if (v.quantity && v.quantity.trim() !== '') {
      qty = parseQty(v.quantity, 3, { allowZero: true });
      if (qty === null) return fail('Quantidade sugerida inválida.', { quantity: ['Informe um número.'] }, raw);
    }
    const { error } = await ctx.supabase.rpc('inv_review_suggestion', { p_id: v.id, p_status: v.status, p_quantity: qty });
    if (error) return fail(dbMessage(error), undefined, raw);
    bust('/reposicao', '/dashboard');
    return succeed(v.status === 'reviewed' ? 'Sugestão marcada como analisada. Ela não vira pedido de compra.' : 'Sugestão descartada.');
  });
}

export async function markNotificationsRead(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(z.object({ id: z.uuid().optional() }), raw, raw);
  if (!p.ok) return p.state;
  return guarded('read', 'markNotificationsRead', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('inv_mark_notifications_read', { p_org: org, p_ids: p.data.id ? [p.data.id] : null });
    if (error) return fail(dbMessage(error));
    bust('/notificacoes');
    return succeed(p.data.id ? 'Aviso marcado como lido.' : 'Todos os avisos foram marcados como lidos.');
  });
}

export async function setNotificationPref(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(notificationPrefSchema, raw, raw);
  if (!p.ok) return p.state;
  if (!(NOTIFICATION_TYPES as readonly string[]).includes(p.data.type)) return fail('Tipo de aviso inválido.');
  return guarded('read', 'setNotificationPref', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('inv_set_notification_pref', { p_org: org, p_type: p.data.type, p_enabled: p.data.enabled });
    if (error) return fail(dbMessage(error));
    bust('/notificacoes');
    return succeed('Preferência salva.');
  });
}
