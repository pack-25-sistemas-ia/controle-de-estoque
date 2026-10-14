'use client';

import { useId, useMemo, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Alert, Field, Input, Select } from '@/components/ui/primitives';
import { cancelImport, commitImport, previewImport } from '@/lib/inventory/actions/imports';
import { CsvError, decodeText, detectDelimiter, FIELDS, MAX_FILE_BYTES, normalizeRows, parseCsv, suggestMapping } from '@/lib/inventory/csv';
import { IMPORT_TYPES, IMPORT_TYPE_HELP, IMPORT_TYPE_LABELS, type ImportType } from '@/lib/inventory/labels';
import { useInvAction } from './use-inv-action';

const DELIMS: Array<{ v: string; label: string }> = [{ v: ';', label: 'Ponto e vírgula ( ; )' }, { v: ',', label: 'Vírgula ( , )' }, { v: 'tab', label: 'Tabulação' }, { v: '|', label: 'Barra vertical ( | )' }];
const TAB = String.fromCharCode(9);

/** Passo 1 → 2: escolher tipo/arquivo, conferir o mapeamento das colunas e a leitura de exemplo. O servidor refaz TODA a leitura e o BANCO valida cada linha. */
export function ImportWizard({ canManager }: { canManager: boolean }) {
  const p = useId();
  const [kind, setKind] = useState<ImportType>('products');
  const [delim, setDelim] = useState(';');
  const [fileInfo, setFileInfo] = useState<{ name: string; encoding: string } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [raw, setRaw] = useState<{ text: string; encoding: string } | null>(null);
  const [state, action, ref] = useInvAction(previewImport, { reset: false });
  const e = state.fieldErrors ?? {};

  // Tudo abaixo é DERIVADO do arquivo, do separador, do tipo e das escolhas (sem efeitos colaterais).
  const parsed = useMemo(() => {
    if (!raw) return { table: null as string[][] | null, error: null as string | null };
    try { return { table: parseCsv(raw.text, delim === 'tab' ? TAB : delim), error: null }; }
    catch (err) { return { table: null, error: err instanceof CsvError ? err.message : 'Não foi possível ler o arquivo.' }; }
  }, [raw, delim]);
  const table = parsed.table;
  const readError = fileError ?? parsed.error;
  const header = useMemo(() => table?.[0] ?? [], [table]);
  const mapping = useMemo(() => ({ ...suggestMapping(kind, header), ...overrides }), [kind, header, overrides]);
  const sample = useMemo(() => (table && table.length >= 2 ? normalizeRows(kind, table.slice(1, 9), mapping) : []), [kind, table, mapping]);
  const specs = FIELDS[kind];
  const missing = specs.filter((f) => f.required && mapping[f.key] == null);
  const dup = useMemo(() => { const vals = Object.values(mapping).filter((v): v is number => v !== null); return new Set(vals).size !== vals.length; }, [mapping]);
  const shown = specs.filter((f) => mapping[f.key] != null).slice(0, 6);

  async function onFile(file: File | undefined) {
    setRaw(null); setFileInfo(null); setFileError(null); setOverrides({});
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setFileError('O arquivo passa de 5 MB. Divida-o em partes menores.'); return; }
    if (!/\.(csv|txt)$/i.test(file.name)) { setFileError('Envie um arquivo .csv (ou .txt). Planilhas XLSX não são aceitas: salve como CSV.'); return; }
    const d = decodeText(new Uint8Array(await file.arrayBuffer()));
    const found = detectDelimiter(d.text);
    setDelim(found === TAB ? 'tab' : found);
    setRaw(d); setFileInfo({ name: file.name, encoding: d.encoding });
  }

  return (
    <form ref={ref} action={action} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="O que importar" name={`${p}kind`} errors={e.kind} hint={IMPORT_TYPE_HELP[kind]}>
          <Select id={`${p}kind`} name="kind" value={kind} onChange={(ev) => { setKind(ev.target.value as ImportType); setOverrides({}); }}>
            {IMPORT_TYPES.filter((k) => canManager || k === 'products').map((k) => <option key={k} value={k}>{IMPORT_TYPE_LABELS[k]}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Arquivo CSV (até 5 MB e 5.000 linhas)" name={`${p}file`}>
            <Input id={`${p}file`} name="file" type="file" accept=".csv,.txt,text/csv,text/plain" required onChange={(ev) => void onFile(ev.target.files?.[0])} />
          </Field>
        </div>
      </div>

      {kind === 'opening' ? <Alert tone="warning">O saldo inicial cria movimentos de abertura no histórico e altera o estoque e o custo. Só vale uma vez por produto e depósito. Confira a prévia com atenção.</Alert> : null}
      {readError ? <Alert tone="error">{readError}</Alert> : null}

      {table && table.length >= 2 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Separador" name={`${p}delimiter`} hint={fileInfo ? `Arquivo «${fileInfo.name}», codificação ${fileInfo.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252 (acentos convertidos)'}.` : undefined}>
              <Select id={`${p}delimiter`} name="delimiter" value={delim} onChange={(ev) => setDelim(ev.target.value)}>{DELIMS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}</Select>
            </Field>
            <p className="self-end pb-2 text-sm text-muted">{table.length - 1} linha(s) de dados e {header.length} coluna(s) encontradas.</p>
          </div>

          <fieldset className="rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-medium">Mapeamento das colunas</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {specs.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} name={`map-${f.key}`} hint={f.hint}>
                  <Select id={`map-${f.key}`} value={mapping[f.key] ?? ''} onChange={(ev) => setOverrides((m) => ({ ...m, [f.key]: ev.target.value === '' ? null : Number(ev.target.value) }))}>
                    <option value="">— não usar —</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            {missing.length ? <p role="alert" className="mt-3 text-sm text-danger">Falta indicar: {missing.map((f) => f.label).join(', ')}.</p> : null}
            {dup ? <p role="alert" className="mt-3 text-sm text-danger">A mesma coluna foi usada em dois campos.</p> : null}
          </fieldset>

          <div>
            <p className="mb-2 text-sm font-medium">Como as primeiras linhas serão lidas</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Leitura de exemplo das primeiras linhas</caption>
                <thead><tr className="text-left text-xs uppercase text-muted"><th scope="col" className="px-3 py-2">Linha</th>{shown.map((f) => <th scope="col" key={f.key} className="px-3 py-2">{f.label}</th>)}<th scope="col" className="px-3 py-2">Leitura</th></tr></thead>
                <tbody>
                  {sample.map((r) => (
                    <tr key={r.row_number} className="border-t border-border">
                      <td className="px-3 py-1.5 tabular-nums">{r.row_number}</td>
                      {shown.map((f) => <td key={f.key} className="max-w-48 truncate px-3 py-1.5">{r.data[f.key] ?? ''}</td>)}
                      <td className="px-3 py-1.5">{r.parse_error ? <span className="text-danger">{r.parse_error}</span> : <span className="text-success">Lida</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
          <FormMessage state={state} />
          <SubmitButton pendingText="Lendo e validando…">Gerar prévia da importação</SubmitButton>
          <p className="text-xs text-muted">Nada é criado ainda: a prévia mostra erros e repetições para você confirmar na próxima tela.</p>
        </>
      ) : <FormMessage state={state} />}
    </form>
  );
}

export function CommitImportForm({ id, kind, validRows }: { id: string; kind: ImportType; validRows: number }) {
  const [state, action] = useInvAction(commitImport, { reset: false });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="kind" value={kind} />
      <SubmitButton pendingText="Importando…">{`Confirmar importação de ${validRows} linha(s)`}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CancelImportForm({ id }: { id: string }) {
  const [state, action] = useInvAction(cancelImport, { reset: false });
  return <form action={action} className="space-y-3"><input type="hidden" name="id" value={id} /><SubmitButton variant="secondary" pendingText="…">Cancelar prévia</SubmitButton><FormMessage state={state} /></form>;
}
