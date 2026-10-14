// Validação de entrada no SERVIDOR (Zod). Quantidades e custos entram como TEXTO e são normalizados em qty.ts; o banco valida de novo.
import { z } from 'zod';
import { checkBarcode } from './barcode';
import { isIsoDate } from './dates';
import { ADJUST_REASONS, ENTRY_REASONS, ISSUE_REASONS, PRODUCT_TYPES } from './labels';
import { MAX_CENTS, parseBRL } from './money';
import { parseQty } from './qty';

export const uuid = z.uuid('Registro inválido.');
export const optionalUuid = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : v), z.uuid('Seleção inválida.').nullable());
const text = (min: number, max: number, label = 'Campo') => z.string().trim().min(min, `${label}: mínimo de ${min} caracteres.`).max(max, `${label}: máximo de ${max} caracteres.`);
export const optionalText = (max: number) => z.preprocess((v) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v), z.string().trim().max(max, `Máximo de ${max} caracteres.`).nullable());
export const flag = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
const optionalDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().refine(isIsoDate, 'Data inválida.').nullable());
export const idemKey = z.preprocess((v) => (typeof v === 'string' && v.length >= 8 ? v : crypto.randomUUID()), z.string().min(8).max(100));

/** Número opcional ≥ 0 com até 3 casas (parâmetros de reposição). Devolve texto decimal com ponto ou null. */
const optionalParam = (label: string) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().nullable()).transform((s, ctx) => {
    if (s === null) return null;
    const q = parseQty(s, 3, { allowZero: true });
    if (q === null) { ctx.addIssue({ code: 'custom', message: `${label}: informe um número (ex.: 12 ou 12,5).` }); return z.NEVER; }
    return q;
  });

const SKU = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;
const barcode = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().nullable()).superRefine((s, ctx) => {
  if (s === null) return;
  const c = checkBarcode(s);
  if (!c.ok) ctx.addIssue({ code: 'custom', message: c.message });
});

// ---- cadastros
export const productSchema = z.object({
  sku: z.string().trim().regex(SKU, 'SKU: até 40 caracteres (letras, números, ponto, hífen, barra ou sublinhado).'),
  name: text(1, 160, 'Nome'),
  barcode,
  category_id: optionalUuid,
  unit_id: uuid,
  description: optionalText(1000),
  price: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().nullable()).transform((s, ctx) => {
    if (s === null) return null;
    const c = parseBRL(s);
    if (c === null || c > MAX_CENTS) { ctx.addIssue({ code: 'custom', message: 'Preço informativo inválido. Use o formato 1.234,56.' }); return z.NEVER; }
    return c as number;
  }),
  product_type: z.enum(PRODUCT_TYPES, 'Tipo inválido.'),
  minimum_stock: optionalParam('Estoque mínimo'),
  reorder_point: optionalParam('Ponto de reposição'),
  target_stock: optionalParam('Estoque-alvo'),
  default_supplier_id: optionalUuid,
}).superRefine((v, ctx) => {
  const n = (s: string | null) => (s === null ? null : Number(s));
  const [mn, rp, tg] = [n(v.minimum_stock), n(v.reorder_point), n(v.target_stock)];
  if (mn !== null && rp !== null && mn > rp) ctx.addIssue({ code: 'custom', path: ['reorder_point'], message: 'O ponto de reposição deve ser maior ou igual ao mínimo.' });
  if (rp !== null && tg !== null && rp > tg) ctx.addIssue({ code: 'custom', path: ['target_stock'], message: 'O estoque-alvo deve ser maior ou igual ao ponto de reposição.' });
  if (mn !== null && tg !== null && mn > tg) ctx.addIssue({ code: 'custom', path: ['target_stock'], message: 'O estoque-alvo deve ser maior ou igual ao mínimo.' });
});
export const productEditSchema = z.object({ id: uuid, status: z.enum(['active', 'inactive'], 'Situação inválida.') }).and(productSchema);
export const archiveSchema = z.object({ id: uuid });

export const categorySchema = z.object({ name: text(1, 80, 'Nome'), parent_id: optionalUuid, description: optionalText(300) });
export const categoryEditSchema = z.object({ id: uuid, name: text(1, 80, 'Nome'), description: optionalText(300), active: flag });

const digitsOrNull = z.preprocess((v) => (typeof v === 'string' ? v.replace(/\D/g, '') : v), z.string().max(20)).transform((v) => (v === '' ? null : v));
export const supplierSchema = z.object({
  name: text(1, 120, 'Nome'),
  legal_name: optionalText(160),
  document_number: digitsOrNull,
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().max(160).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'E-mail inválido.').nullable()),
  phone: optionalText(30),
  lead_time_days: z.preprocess((v) => (v === '' || v === undefined ? null : Number(v)), z.number().int('Informe dias inteiros.').min(0).max(365, 'Máximo de 365 dias.').nullable()),
  notes: optionalText(500),
});
export const supplierEditSchema = z.object({ id: uuid, active: flag }).and(supplierSchema);

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
export const warehouseSchema = z.object({
  name: text(1, 80, 'Nome'),
  code: z.string().trim().regex(CODE, 'Código: até 20 letras, números, ponto, hífen ou sublinhado.'),
  description: optionalText(300),
  address: optionalText(300),
});
export const warehouseEditSchema = z.object({ id: uuid, active: flag }).and(warehouseSchema);
export const locationSchema = z.object({ warehouse_id: uuid, parent_id: optionalUuid, code: z.string().trim().regex(CODE, 'Código: até 20 letras, números, ponto, hífen ou sublinhado.'), name: text(1, 80, 'Nome') });
export const accessSchema = z.object({ user_id: uuid, warehouse_id: uuid });
export const unitSchema = z.object({ symbol: text(1, 8, 'Símbolo'), name: text(1, 40, 'Nome'), decimal_places: z.coerce.number().int().min(0).max(3) });
export const unitEditSchema = z.object({ id: uuid, symbol: text(1, 8, 'Símbolo'), name: text(1, 40, 'Nome'), active: flag });
export const productSupplierSchema = z.object({
  product_id: uuid, supplier_id: uuid, supplier_sku: optionalText(60), is_preferred: flag,
  lead_time_days: z.preprocess((v) => (v === '' || v === undefined ? null : Number(v)), z.number().int().min(0).max(365).nullable()),
});
export const ruleSchema = z.object({
  product_id: uuid, warehouse_id: optionalUuid,
  minimum_quantity: optionalParam('Mínimo'), reorder_point: optionalParam('Ponto de reposição'), target_quantity: optionalParam('Estoque-alvo'),
  lead_time_days: z.preprocess((v) => (v === '' || v === undefined ? null : Number(v)), z.number().int().min(0).max(365).nullable()),
}).superRefine((v, ctx) => {
  if (v.minimum_quantity === null) ctx.addIssue({ code: 'custom', path: ['minimum_quantity'], message: 'Informe o mínimo.' });
  if (v.reorder_point === null) ctx.addIssue({ code: 'custom', path: ['reorder_point'], message: 'Informe o ponto de reposição.' });
  if (v.minimum_quantity !== null && v.reorder_point !== null && Number(v.minimum_quantity) > Number(v.reorder_point)) ctx.addIssue({ code: 'custom', path: ['reorder_point'], message: 'O ponto de reposição deve ser maior ou igual ao mínimo.' });
  if (v.reorder_point !== null && v.target_quantity !== null && Number(v.reorder_point) > Number(v.target_quantity)) ctx.addIssue({ code: 'custom', path: ['target_quantity'], message: 'O estoque-alvo deve ser maior ou igual ao ponto de reposição.' });
});
export const settingsSchema = z.object({
  idle_days: z.coerce.number().int().min(7, 'Mínimo de 7 dias.').max(730, 'Máximo de 730 dias.'),
  coverage_window_days: z.coerce.number().int().min(7, 'Mínimo de 7 dias.').max(365, 'Máximo de 365 dias.'),
  label_company_name: flag,
  label_show_price: flag,
});

// ---- operações de estoque: as linhas chegam como JSON (texto) montado pelo editor de itens
export const lineSchema = z.object({
  product_id: uuid,
  quantity: z.string().trim().min(1, 'Informe a quantidade.').max(30),
  cost: z.string().trim().max(30).optional().default(''),
  cost_mode: z.enum(['informed', 'average', 'original', 'none']).optional(),
  reference_movement_id: z.uuid().optional(),
});
export type Line = z.infer<typeof lineSchema>;
export const linesJson = z.string().transform((s, ctx) => {
  try {
    const arr: unknown = JSON.parse(s);
    const r = z.array(lineSchema).min(1, 'Inclua ao menos um item.').max(200, 'No máximo 200 itens por operação.').safeParse(arr);
    if (!r.success) { ctx.addIssue({ code: 'custom', message: r.error.issues[0]?.message ?? 'Itens inválidos.' }); return z.NEVER; }
    return r.data;
  } catch { ctx.addIssue({ code: 'custom', message: 'Inclua ao menos um item.' }); return z.NEVER; }
});

const opBase = { warehouse_id: uuid, occurred_on: optionalDate, notes: optionalText(500), items: linesJson, idem: idemKey };
export const entrySchema = z.object({ ...opBase, reason: z.enum(ENTRY_REASONS, 'Motivo inválido.'), supplier_id: optionalUuid, external_reference: optionalText(60) });
export const issueSchema = z.object({ ...opBase, reason: z.enum(ISSUE_REASONS, 'Motivo inválido.'), external_reference: optionalText(60) });
export const transferSchema = z.object({ source_id: uuid, destination_id: uuid, occurred_on: optionalDate, notes: optionalText(500), items: linesJson, idem: idemKey })
  .refine((v) => v.source_id !== v.destination_id, { path: ['destination_id'], message: 'Origem e destino devem ser diferentes.' });
export const adjustmentSchema = z.object({
  ...opBase, direction: z.enum(['in', 'out'], 'Direção inválida.'), reason: z.enum(ADJUST_REASONS, 'Motivo inválido.'), justification: text(5, 500, 'Justificativa'),
});
export const openingSchema = z.object({ warehouse_id: uuid, occurred_on: optionalDate, items: linesJson, idem: idemKey });
export const reverseSchema = z.object({ id: uuid, reason: text(5, 300, 'Motivo'), idem: idemKey });

// ---- inventário e reposição
export const countCreateSchema = z.object({ warehouse_id: uuid, title: text(1, 120, 'Título'), notes: optionalText(500), skus: z.string().max(10000).optional() });
export const countRecordSchema = z.object({ item_id: uuid, counted: z.string().trim().min(1, 'Informe a quantidade contada.').max(30), note: optionalText(300) });
export const countIdSchema = z.object({ id: uuid });
export const countCancelSchema = z.object({ id: uuid, reason: text(5, 300, 'Motivo') });
export const countAddProductSchema = z.object({ id: uuid, product_id: uuid });
export const surplusCostSchema = z.object({ item_id: uuid, cost: z.string().trim().max(30) });
export const suggestionReviewSchema = z.object({ id: uuid, status: z.enum(['reviewed', 'dismissed'], 'Situação inválida.'), quantity: z.string().trim().max(30).optional() });

export const notificationPrefSchema = z.object({ type: z.string().min(3).max(40), enabled: flag });
