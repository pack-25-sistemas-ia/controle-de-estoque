'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bust, bustInventory, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import {
  accessSchema, archiveSchema, categoryEditSchema, categorySchema, locationSchema, productEditSchema, productSchema, productSupplierSchema, ruleSchema, settingsSchema,
  supplierEditSchema, supplierSchema, unitEditSchema, unitSchema, uuid, warehouseEditSchema, warehouseSchema,
} from '../schemas';
import { z } from 'zod';

// Cadastros: escrita direta pelo cliente do usuário (RLS + privilégios por coluna + gatilhos + MFA no banco decidem de novo).
const dupSku = 'Já existe um produto com este SKU ou código de barras.';

export async function createProduct(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(productSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'createProduct', async (ctx, org) => {
    const v = p.data;
    const { data, error } = await ctx.supabase.from('products').insert({
      organization_id: org, sku: v.sku, name: v.name, barcode: v.barcode, category_id: v.category_id, unit_id: v.unit_id, description: v.description, product_type: v.product_type, list_price_cents: v.price,
      minimum_stock: v.minimum_stock, reorder_point: v.reorder_point, target_stock: v.target_stock, default_supplier_id: v.default_supplier_id,
    }).select('id').single();
    if (error) return fail(dbMessage(error, dupSku), undefined, raw);
    bustInventory();
    return { ...succeed('Produto cadastrado.'), id: data.id as string, redirectTo: `/produtos/${data.id as string}` };
  });
}

export async function updateProduct(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(productEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'updateProduct', async (ctx, org) => {
    const v = p.data;
    const patch: Record<string, unknown> = { sku: v.sku, name: v.name, barcode: v.barcode, category_id: v.category_id, unit_id: v.unit_id, description: v.description, product_type: v.product_type, list_price_cents: v.price, status: v.status };
    // operador não envia parâmetros de reposição (o gatilho também recusa); gestor sim
    if (ctx.membership.role !== 'member') Object.assign(patch, { minimum_stock: v.minimum_stock, reorder_point: v.reorder_point, target_stock: v.target_stock, default_supplier_id: v.default_supplier_id });
    const { error } = await ctx.supabase.from('products').update(patch).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, dupSku), undefined, raw);
    bustInventory();
    return succeed('Produto atualizado. Os movimentos antigos continuam intactos.');
  });
}

export async function setProductArchived(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(archiveSchema.extend({ archive: z.enum(['1', '0']) }), raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'setProductArchived', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('products').update({ archived_at: v.archive === '1' ? new Date().toISOString() : null }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return succeed(v.archive === '1' ? 'Produto arquivado (o histórico permanece).' : 'Produto reativado.');
  });
}

export async function createCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(categorySchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createCategory', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('product_categories').insert({ organization_id: org, name: v.name, parent_id: v.parent_id, description: v.description });
    if (error) return fail(dbMessage(error, 'Já existe uma categoria com este nome neste nível.'), undefined, raw);
    bust('/categorias', '/produtos');
    return succeed('Categoria criada.');
  });
}

export async function updateCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(categoryEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateCategory', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('product_categories').update({ name: v.name, description: v.description, active: v.active }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, 'Já existe uma categoria com este nome neste nível.'), undefined, raw);
    bust('/categorias', '/produtos');
    return succeed(v.active ? 'Categoria atualizada.' : 'Categoria desativada (os produtos continuam intactos).');
  });
}

export async function createSupplier(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(supplierSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createSupplier', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('suppliers').insert({ organization_id: org, name: v.name, legal_name: v.legal_name, document_number: v.document_number, email: v.email, phone: v.phone, lead_time_days: v.lead_time_days, notes: v.notes });
    if (error) return fail(dbMessage(error, 'Já existe um fornecedor com este nome.'), undefined, raw);
    bust('/fornecedores');
    return succeed('Fornecedor cadastrado.');
  });
}

export async function updateSupplier(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(supplierEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateSupplier', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('suppliers').update({ name: v.name, legal_name: v.legal_name, document_number: v.document_number, email: v.email, phone: v.phone, lead_time_days: v.lead_time_days, notes: v.notes, active: v.active }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, 'Já existe um fornecedor com este nome.'), undefined, raw);
    bust('/fornecedores', '/produtos');
    return succeed('Fornecedor atualizado.');
  });
}

export async function createWarehouse(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(warehouseSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createWarehouse', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('warehouses').insert({ organization_id: org, name: v.name, code: v.code, description: v.description, address: v.address });
    if (error) return fail(dbMessage(error, 'Já existe um depósito com este nome ou código.'), undefined, raw);
    bustInventory();
    return succeed('Depósito criado.');
  });
}

export async function updateWarehouse(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(warehouseEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateWarehouse', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('warehouses').update({ name: v.name, code: v.code, description: v.description, address: v.address, active: v.active }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, 'Já existe um depósito com este nome ou código.'), undefined, raw);
    bustInventory();
    return succeed(v.active ? 'Depósito atualizado.' : 'Depósito arquivado (não recebe novas operações).');
  });
}

export async function createLocation(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(locationSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createLocation', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('warehouse_locations').insert({ organization_id: org, warehouse_id: v.warehouse_id, parent_id: v.parent_id, code: v.code, name: v.name });
    if (error) return fail(dbMessage(error, 'Já existe uma localização com este código neste nível.'), undefined, raw);
    bust('/depositos');
    return succeed('Localização criada.');
  });
}

export async function grantAccess(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(accessSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('admin', 'grantAccess', async (ctx, org) => {
    const { error } = await ctx.supabase.from('warehouse_access').insert({ organization_id: org, user_id: p.data.user_id, warehouse_id: p.data.warehouse_id });
    if (error) return fail(dbMessage(error, 'Este operador já tem acesso a este depósito.'), undefined, raw);
    bust('/depositos', '/configuracoes');
    return succeed('Acesso concedido. A partir de agora o operador só opera nos depósitos autorizados.');
  });
}

export async function revokeAccess(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(accessSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('admin', 'revokeAccess', async (ctx, org) => {
    const { error } = await ctx.supabase.from('warehouse_access').delete().eq('organization_id', org).eq('user_id', p.data.user_id).eq('warehouse_id', p.data.warehouse_id);
    if (error) return fail(dbMessage(error), undefined, raw);
    bust('/depositos', '/configuracoes');
    return succeed('Acesso removido. Sem nenhuma autorização, o operador volta a operar em todos os depósitos.');
  });
}

export async function createUnit(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(unitSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createUnit', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('units_of_measure').insert({ organization_id: org, symbol: v.symbol, name: v.name, decimal_places: v.decimal_places });
    if (error) return fail(dbMessage(error, 'Já existe uma unidade com este símbolo.'), undefined, raw);
    bust('/configuracoes', '/produtos');
    return succeed('Unidade criada. O número de casas decimais não pode mais ser alterado.');
  });
}

export async function updateUnit(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(unitEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateUnit', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('units_of_measure').update({ symbol: v.symbol, name: v.name, active: v.active }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, 'Já existe uma unidade com este símbolo.'), undefined, raw);
    bust('/configuracoes', '/produtos');
    return succeed('Unidade atualizada.');
  });
}

export async function linkSupplier(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(productSupplierSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'linkSupplier', async (ctx, org) => {
    const v = p.data;
    if (v.is_preferred) await ctx.supabase.from('product_suppliers').update({ is_preferred: false }).eq('organization_id', org).eq('product_id', v.product_id);
    const { error } = await ctx.supabase.from('product_suppliers').upsert({ organization_id: org, product_id: v.product_id, supplier_id: v.supplier_id, supplier_sku: v.supplier_sku, lead_time_days: v.lead_time_days, is_preferred: v.is_preferred }, { onConflict: 'product_id,supplier_id' });
    if (error) return fail(dbMessage(error), undefined, raw);
    bust(`/produtos/${v.product_id}`, '/fornecedores');
    return succeed('Fornecedor associado ao produto.');
  });
}

export async function unlinkSupplier(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(z.object({ id: uuid, product_id: uuid }), raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'unlinkSupplier', async (ctx, org) => {
    const { error } = await ctx.supabase.from('product_suppliers').delete().eq('organization_id', org).eq('id', p.data.id);
    if (error) return fail(dbMessage(error), undefined, raw);
    bust(`/produtos/${p.data.product_id}`, '/fornecedores');
    return succeed('Associação removida.');
  });
}

export async function saveRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(ruleSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'saveRule', async (ctx, org) => {
    const v = p.data;
    const row = { organization_id: org, product_id: v.product_id, warehouse_id: v.warehouse_id, minimum_quantity: v.minimum_quantity, reorder_point: v.reorder_point, target_quantity: v.target_quantity, lead_time_days: v.lead_time_days, enabled: true };
    let q = ctx.supabase.from('reorder_rules').select('id').eq('organization_id', org).eq('product_id', v.product_id);
    q = v.warehouse_id ? q.eq('warehouse_id', v.warehouse_id) : q.is('warehouse_id', null);
    const { data: ex, error: e1 } = await q.maybeSingle();
    if (e1) return fail(dbMessage(e1), undefined, raw);
    const { error } = ex
      ? await ctx.supabase.from('reorder_rules').update({ minimum_quantity: row.minimum_quantity, reorder_point: row.reorder_point, target_quantity: row.target_quantity, lead_time_days: row.lead_time_days, enabled: true }).eq('id', ex.id as string)
      : await ctx.supabase.from('reorder_rules').insert(row);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return succeed('Regra de reposição salva.');
  });
}

export async function deleteRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(z.object({ id: uuid }), raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'deleteRule', async (ctx, org) => {
    const { error } = await ctx.supabase.from('reorder_rules').delete().eq('organization_id', org).eq('id', p.data.id);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return succeed('Regra removida: o produto volta a usar o padrão do cadastro.');
  });
}

export async function updateSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(settingsSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('admin', 'updateSettings', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('inv_settings').update({ idle_days: v.idle_days, coverage_window_days: v.coverage_window_days, label_company_name: v.label_company_name, label_show_price: v.label_show_price }).eq('organization_id', org);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustInventory();
    return succeed('Configurações salvas.');
  });
}
