'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { logEvent } from '@/lib/log';
import { bustInventory, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { CsvError, decodeText, FIELDS, MAX_FILE_BYTES, MAX_ROWS, normalizeRows, parseCsv, sha256Hex } from '../csv';
import { IMPORT_TYPES } from '../labels';
import { uuid } from '../schemas';

const DELIMITERS = new Set([';', ',', '\t', '|']);
const levelOf = (t: string) => (t === 'products' ? 'operator' : 'manager') as 'operator' | 'manager';

/** Etapa 1 → prévia: o arquivo é lido no servidor e o BANCO valida cada linha; nada é criado até a confirmação (commitImport). */
export async function previewImport(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const start = parse(z.object({ kind: z.enum(IMPORT_TYPES, 'Tipo de importação inválido.') }), raw);
  if (!start.ok) return start.state;
  const kind = start.data.kind;
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Selecione um arquivo CSV.');
  if (file.size > MAX_FILE_BYTES) return fail('O arquivo passa de 5 MB. Divida-o em partes menores.');
  if (!/\.(csv|txt)$/i.test(file.name)) return fail('Envie um arquivo .csv (ou .txt) separado por vírgula ou ponto e vírgula. XLSX não é aceito: salve a planilha como CSV.');
  const delimiter = raw.delimiter === 'tab' ? '\t' : (raw.delimiter ?? ';');
  if (!DELIMITERS.has(delimiter)) return fail('Separador inválido.');
  let mapping: Record<string, number | null>;
  try {
    mapping = z.record(z.string(), z.number().int().min(0).max(59).nullable()).parse(JSON.parse(raw.mapping ?? '{}'));
  } catch {
    return fail('Mapeamento de colunas inválido.');
  }

  return guarded(levelOf(kind), 'previewImport', async (ctx, org) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // tipo real: arquivo de texto (sem bytes nulos nem assinatura binária conhecida: ZIP/XLSX, PDF)
    if (bytes.subarray(0, 4096).includes(0) || (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0x25 && bytes[1] === 0x50)) return fail('O arquivo não é um CSV de texto. Exporte a planilha como CSV.');
    let table: string[][];
    try {
      table = parseCsv(decodeText(bytes).text, delimiter);
    } catch (e) {
      return fail(e instanceof CsvError ? e.message : 'Não foi possível ler o arquivo.');
    }
    if (table.length < 2) return fail('O arquivo precisa de um cabeçalho e ao menos uma linha de dados.');
    if (table.length - 1 > MAX_ROWS) return fail(`O arquivo tem mais de ${MAX_ROWS.toLocaleString('pt-BR')} linhas.`);
    const header = table[0]!;
    const specs = FIELDS[kind];
    const used = new Set<number>();
    for (const f of specs) {
      const idx = mapping[f.key] ?? null;
      if (idx !== null) {
        if (idx >= header.length) return fail(`A coluna escolhida para «${f.label}» não existe no arquivo.`);
        if (used.has(idx)) return fail('A mesma coluna foi usada para dois campos.');
        used.add(idx);
      }
    }
    for (const k of Object.keys(mapping)) if (!specs.some((f) => f.key === k)) return fail('Mapeamento de colunas inválido.');
    for (const f of specs.filter((x) => x.required)) if (mapping[f.key] == null) return fail(`Indique qual coluna contém «${f.label}».`);

    const rows = normalizeRows(kind, table.slice(1), mapping).map((r) => r.data);
    const fileHash = await sha256Hex(`${kind}|${JSON.stringify(Object.entries(mapping).sort())}|${await sha256Hex(bytes)}`);
    const { data, error } = await ctx.supabase.rpc('inv_create_import', { p_org: org, p_type: kind, p_file_name: file.name.slice(0, 200), p_file_hash: fileHash, p_rows: rows });
    if (error) return fail(dbMessage(error), undefined, raw);
    const r = data as { duplicate_file: boolean; import_id: string };
    logEvent('info', 'inv_import_previewed', { kind, rows: rows.length });
    if (r.duplicate_file) return { ...fail('Este arquivo (com este mapeamento) já foi importado. Veja o resultado na lista de importações.'), id: r.import_id };
    bustInventory();
    return { ...succeed('Prévia gerada. Revise e confirme.'), id: r.import_id, redirectTo: `/importacoes/${r.import_id}` };
  });
}

export async function commitImport(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = parse(z.object({ id: uuid, kind: z.enum(IMPORT_TYPES) }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded(levelOf(p.data.kind), 'commitImport', async (ctx) => {
    const { data, error } = await ctx.supabase.rpc('inv_commit_import', { p_job: p.data.id });
    if (error) return fail(dbMessage(error));
    bustInventory();
    const r = data as { already: boolean; accepted: number; rejected?: number };
    return succeed(r.already ? 'Esta importação já havia sido confirmada.' : `Importação concluída: ${r.accepted} linha(s) importada(s) e ${r.rejected ?? 0} rejeitada(s).`);
  });
}

export async function cancelImport(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = parse(z.object({ id: uuid }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('operator', 'cancelImport', async (ctx) => {
    const { error } = await ctx.supabase.rpc('inv_cancel_import', { p_job: p.data.id });
    if (error) return fail(dbMessage(error));
    bustInventory();
    return succeed('Prévia cancelada. Nada foi importado.');
  });
}
