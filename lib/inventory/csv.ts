// CSV: leitura (RFC 4180 + padrões brasileiros) e escrita segura. Módulo puro — roda no navegador (prévia do mapeamento) e no servidor (valor final).
import { parseQty, parseUnitCostCents } from './qty';
import type { ImportType } from './labels';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
const MAX_COLS = 60;
const MAX_FIELD = 2000;

/** Decodifica bytes: UTF-8 estrito; se falhar (arquivos do Excel/bancos), Windows-1252. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r\n|\n|\r/).slice(0, 5).filter((l) => l.trim() !== '');
  let best = ',';
  let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = sample.map((line) => { let n = 0; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; });
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = counts[0]! * (consistent ? 1000 : 1);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export class CsvError extends Error {}

/** Lê o CSV em matriz de células. Aspas duplas, aspas escapadas («""»), quebras de linha dentro de campo, CRLF/LF/CR. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    if (field.length > MAX_FIELD) throw new CsvError('Há uma célula com mais de 2.000 caracteres.');
    row.push(field); field = '';
    if (row.length > MAX_COLS) throw new CsvError('O arquivo tem colunas demais (máximo de 60).');
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0]!.trim() === '')) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1) throw new CsvError(`O arquivo tem mais de ${MAX_ROWS.toLocaleString('pt-BR')} linhas.`);
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { pushField(); i++; continue; }
    if (ch === '\r') { pushRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { pushRow(); i++; continue; }
    field += ch; i++;
  }
  if (inQuotes) throw new CsvError('Aspas não fechadas: o arquivo parece truncado ou malformado.');
  if (field !== '' || row.length) pushRow();
  return rows;
}

export const normalizeHeader = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------------------- campos por tipo de importação
export type FieldSpec = { key: string; label: string; required: boolean; aliases: string[]; hint?: string };
export const FIELDS: Record<ImportType, FieldSpec[]> = {
  products: [
    { key: 'sku', label: 'SKU', required: true, aliases: ['sku', 'codigo', 'cod', 'referencia', 'ref', 'codigo interno'], hint: 'Único por empresa (não diferencia maiúsculas).' },
    { key: 'name', label: 'Nome', required: true, aliases: ['nome', 'produto', 'descricao', 'name', 'titulo'] },
    { key: 'unit', label: 'Unidade (símbolo)', required: true, aliases: ['unidade', 'un', 'unid', 'unit', 'medida'], hint: 'Ex.: un, kg, L. Precisa existir.' },
    { key: 'category', label: 'Categoria', required: false, aliases: ['categoria', 'category', 'grupo'], hint: 'Precisa existir (importe as categorias antes).' },
    { key: 'barcode', label: 'Código de barras', required: false, aliases: ['codigo de barras', 'ean', 'gtin', 'barras', 'barcode', 'cod barras'] },
    { key: 'description', label: 'Descrição', required: false, aliases: ['detalhes', 'observacao', 'descricao longa', 'description'] },
    { key: 'type', label: 'Tipo', required: false, aliases: ['tipo', 'type', 'tipo de produto'], hint: 'Mercadoria, Matéria-prima, Insumo, Material de consumo ou Outro.' },
    { key: 'minimum', label: 'Estoque mínimo', required: false, aliases: ['minimo', 'estoque minimo', 'min'], hint: 'Só gestor/administrador.' },
    { key: 'reorder_point', label: 'Ponto de reposição', required: false, aliases: ['ponto de reposicao', 'reposicao', 'ponto pedido', 'ponto de pedido'] },
    { key: 'target', label: 'Estoque-alvo', required: false, aliases: ['alvo', 'estoque alvo', 'maximo', 'estoque maximo', 'target'] },
    { key: 'supplier', label: 'Fornecedor principal', required: false, aliases: ['fornecedor', 'supplier'], hint: 'Precisa existir.' },
  ],
  suppliers: [
    { key: 'name', label: 'Nome', required: true, aliases: ['nome', 'fornecedor', 'name', 'razao social'] },
    { key: 'legal_name', label: 'Razão social', required: false, aliases: ['razao social', 'razao', 'legal name'] },
    { key: 'document', label: 'CPF/CNPJ', required: false, aliases: ['cnpj', 'cpf', 'cpf cnpj', 'documento'] },
    { key: 'email', label: 'E-mail', required: false, aliases: ['email', 'e mail'] },
    { key: 'phone', label: 'Telefone', required: false, aliases: ['telefone', 'celular', 'fone', 'phone'] },
    { key: 'lead_time_days', label: 'Prazo de entrega (dias)', required: false, aliases: ['prazo', 'prazo de entrega', 'lead time', 'dias'] },
    { key: 'notes', label: 'Observações', required: false, aliases: ['observacao', 'observacoes', 'obs', 'notes'] },
  ],
  categories: [
    { key: 'name', label: 'Nome', required: true, aliases: ['nome', 'categoria', 'name'] },
    { key: 'parent', label: 'Categoria-pai', required: false, aliases: ['pai', 'categoria pai', 'parent', 'categoria superior'], hint: 'Precisa existir ou vir antes no arquivo.' },
    { key: 'description', label: 'Descrição', required: false, aliases: ['descricao', 'description', 'obs'] },
  ],
  opening: [
    { key: 'sku', label: 'SKU', required: true, aliases: ['sku', 'codigo', 'cod', 'referencia'] },
    { key: 'warehouse', label: 'Depósito (código)', required: true, aliases: ['deposito', 'codigo deposito', 'armazem', 'warehouse', 'local'] },
    { key: 'quantity', label: 'Quantidade', required: true, aliases: ['quantidade', 'qtd', 'qtde', 'saldo', 'estoque', 'quantity'] },
    { key: 'unit_cost', label: 'Custo unitário (R$)', required: false, aliases: ['custo', 'custo unitario', 'preco de custo', 'valor unitario', 'cost'], hint: 'Obrigatório, exceto se a coluna de política indicar «sem custo».' },
    { key: 'cost_mode', label: 'Sem custo? (sim/não)', required: false, aliases: ['sem custo', 'bonificacao'], hint: 'Marque «sim» só para bonificação.' },
  ],
  reorder: [
    { key: 'sku', label: 'SKU', required: true, aliases: ['sku', 'codigo', 'cod', 'referencia'] },
    { key: 'warehouse', label: 'Depósito (código)', required: false, aliases: ['deposito', 'codigo deposito', 'armazem', 'warehouse'], hint: 'Vazio = padrão do produto.' },
    { key: 'minimum', label: 'Mínimo', required: true, aliases: ['minimo', 'estoque minimo', 'min'] },
    { key: 'reorder_point', label: 'Ponto de reposição', required: true, aliases: ['ponto de reposicao', 'reposicao', 'ponto pedido', 'ponto de pedido'] },
    { key: 'target', label: 'Estoque-alvo', required: false, aliases: ['alvo', 'estoque alvo', 'maximo', 'target'] },
    { key: 'lead_time_days', label: 'Prazo de entrega (dias)', required: false, aliases: ['prazo', 'lead time', 'dias'] },
  ],
};

/** Sugere o mapeamento campo → índice de coluna pelos nomes do cabeçalho (nunca repete coluna). */
export function suggestMapping(kind: ImportType, headers: string[]): Record<string, number | null> {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const out: Record<string, number | null> = {};
  for (const f of FIELDS[kind]) {
    let found: number | null = null;
    for (const alias of f.aliases) {
      const idx = norm.findIndex((h, i) => !used.has(i) && h === alias);
      if (idx >= 0) { found = idx; break; }
    }
    if (found === null) {
      for (const alias of f.aliases) {
        const idx = norm.findIndex((h, i) => !used.has(i) && h.includes(alias));
        if (idx >= 0) { found = idx; break; }
      }
    }
    if (found !== null) used.add(found);
    out[f.key] = found;
  }
  return out;
}

// ---------------------------------------------------------------------------- linhas normalizadas (o banco valida de novo)
export type NormalizedRow = { row_number: number; data: Record<string, string>; parse_error: string | null };

const cell = (row: string[], idx: number | null | undefined) => (idx === null || idx === undefined ? '' : (row[idx] ?? '').trim());
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const TYPE_BY_LABEL: Record<string, string> = {
  mercadoria: 'merchandise', 'materia prima': 'raw_material', 'materia-prima': 'raw_material', insumo: 'supply', 'material de consumo': 'consumable', outro: 'other',
  merchandise: 'merchandise', raw_material: 'raw_material', supply: 'supply', consumable: 'consumable', other: 'other',
};
const YES = new Set(['sim', 's', 'yes', 'y', '1', 'true', 'x']);

/** Leitura síncrona das linhas (sem hash): serve à prévia do mapeamento no navegador e é a base do envio ao banco. Erro de leitura vira `parse_error` por linha. */
export function normalizeRows(kind: ImportType, rows: string[][], mapping: Record<string, number | null>, firstRowNumber = 2): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  for (let n = 0; n < rows.length; n++) {
    const row = rows[n]!;
    const g = (k: string) => clean(cell(row, mapping[k]));
    const data: Record<string, string> = {};
    let err: string | null = null;
    const setText = (k: string, max: number) => { const v = g(k); if (v) data[k] = v.slice(0, max); };
    const setNum = (k: string, label: string, decimals = 3) => {
      const v = g(k);
      if (!v) return;
      const q = parseQty(v, decimals, { allowZero: true });
      if (q === null) err ??= `${label} «${v.slice(0, 20)}» não é um número válido (use 12 ou 12,5)`; else data[k] = q;
    };

    if (kind === 'products') {
      setText('sku', 40); setText('name', 160); setText('unit', 8); setText('category', 80); setText('barcode', 48); setText('description', 1000); setText('supplier', 120);
      const t = g('type');
      if (t) { const code = TYPE_BY_LABEL[normalizeHeader(t)] ?? TYPE_BY_LABEL[t.toLowerCase()]; if (code) data.type = code; else err ??= `tipo «${t.slice(0, 20)}» desconhecido`; }
      setNum('minimum', 'mínimo'); setNum('reorder_point', 'ponto de reposição'); setNum('target', 'estoque-alvo');
    } else if (kind === 'suppliers') {
      setText('name', 120); setText('legal_name', 160); setText('phone', 30); setText('notes', 500);
      const doc = g('document').replace(/\D/g, '');
      if (doc) data.document = doc.slice(0, 20);
      const em = g('email').toLowerCase();
      if (em) data.email = em;
      setNum('lead_time_days', 'prazo', 0);
    } else if (kind === 'categories') {
      setText('name', 80); setText('parent', 80); setText('description', 300);
    } else if (kind === 'opening') {
      setText('sku', 40); setText('warehouse', 20);
      setNum('quantity', 'quantidade');
      const cost = g('unit_cost');
      if (cost) { const c = parseUnitCostCents(cost); if (c === null) err ??= `custo «${cost.slice(0, 20)}» não é válido (use 12,34)`; else data.unit_cost = c; }
      data.cost_mode = YES.has(g('cost_mode').toLowerCase()) ? 'none' : 'informed';
    } else {
      setText('sku', 40); setText('warehouse', 20);
      setNum('minimum', 'mínimo'); setNum('reorder_point', 'ponto de reposição'); setNum('target', 'estoque-alvo'); setNum('lead_time_days', 'prazo', 0);
    }
    if (err) data._parse_error = err;
    out.push({ row_number: firstRowNumber + n, data, parse_error: err });
  }
  return out;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------- escrita segura
export type NumCell = { num: string };
export type CsvValue = string | number | null | undefined | NumCell;

/** Neutraliza injeção de fórmula (=, +, -, @, TAB, CR no início de TEXTO). Números formais passam como {num}. */
export function safeCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const raw = typeof v === 'string' ? v : v.num;
  const text = typeof v === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[";\n\r,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV com ponto-e-vírgula e BOM (abre direto no Excel brasileiro). */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header.map(safeCell).join(';'), ...rows.map((r) => r.map(safeCell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
