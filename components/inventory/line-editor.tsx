'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Input, Select } from '@/components/ui/primitives';
import { formatQty, parseQty } from '@/lib/inventory/qty';
import { Scanner } from './scanner';

export type Prod = { id: string; sku: string; name: string; barcode: string | null; unit: string; decimals: number; balance: number | null };
type CostMode = 'informed' | 'average' | 'none';
type Line = { key: string; p: Prod; quantity: string; cost: string; costMode: CostMode };

export type EditorMode = 'entry' | 'issue' | 'transfer' | 'adjust_in' | 'adjust_out' | 'opening';

const COST_MODES: Record<string, Array<{ v: CostMode; label: string }>> = {
  purchase: [{ v: 'informed', label: 'Custo informado' }, { v: 'none', label: 'Sem custo (bonificação)' }],
  opening: [{ v: 'informed', label: 'Custo informado' }, { v: 'none', label: 'Sem custo' }],
  other: [{ v: 'average', label: 'Custo médio atual' }, { v: 'informed', label: 'Custo informado' }, { v: 'none', label: 'Sem custo' }],
};

/**
 * Editor de itens da operação: busca por nome/SKU/código, leitor USB (digitar + Enter), câmera opcional e quantidade/custo por linha.
 * Envia tudo em um campo oculto «items» (JSON de TEXTOS digitados); o servidor normaliza e o BANCO valida de verdade (escala, saldo, custo).
 */
export function LineEditor({ mode, warehouseId, reason = '', errors }: { mode: EditorMode; warehouseId: string; reason?: string; errors?: string[] }) {
  const uid = useId();
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Prod[]>([]);
  const [note, setNote] = useState('');
  const [scan, setScan] = useState(false);
  const searchSeq = useRef(0);

  const costKind = mode === 'entry' ? (reason === 'purchase' ? 'purchase' : 'other') : mode === 'opening' ? 'opening' : mode === 'adjust_in' ? 'other' : null;
  const defaultCost: CostMode = costKind === 'purchase' || costKind === 'opening' ? 'informed' : 'average';
  const showBalance = mode === 'issue' || mode === 'transfer' || mode === 'adjust_out';

  const fetchProducts = useCallback(async (params: string): Promise<Prod[]> => {
    const res = await fetch(`/api/products/search?${params}${warehouseId ? `&wh=${warehouseId}` : ''}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: Prod[] };
    return body.items ?? [];
  }, [warehouseId]);

  // busca com atraso curto
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => { const r = await fetchProducts(`q=${encodeURIComponent(text)}`); if (seq === searchSeq.current) setResults(r); }, 250);
    return () => clearTimeout(t);
  }, [q, fetchProducts]);

  // trocar o depósito atualiza os saldos mostrados
  useEffect(() => {
    if (!showBalance || !warehouseId) return;
    let alive = true;
    void (async () => {
      const updates = await Promise.all(lines.map(async (l) => (await fetchProducts(`code=${encodeURIComponent(l.p.sku)}`)).find((x) => x.id === l.p.id)));
      if (!alive) return;
      setLines((cur) => cur.map((l) => { const u = updates.find((x) => x?.id === l.p.id); return u ? { ...l, p: { ...l.p, balance: u.balance } } : l; }));
    })();
    return () => { alive = false; };
    // só quando o depósito muda (as linhas mudam por outras razões)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  function add(p: Prod) {
    setResults([]); setQ('');
    setLines((cur) => {
      const ex = cur.find((l) => l.p.id === p.id);
      if (ex) {
        // mesmo produto lido de novo: soma 1 (unidade inteira) em vez de repetir a linha
        const cur_ = parseQty(ex.quantity, p.decimals);
        const next = cur_ !== null && p.decimals === 0 ? String(Number(cur_) + 1) : ex.quantity;
        setNote(`${p.sku} já estava na lista: quantidade ${p.decimals === 0 ? 'aumentada em 1' : 'mantida (ajuste manualmente)'}.`);
        return cur.map((l) => (l.p.id === p.id ? { ...l, quantity: next } : l));
      }
      setNote(`${p.sku} — ${p.name} adicionado.`);
      return [...cur, { key: crypto.randomUUID(), p, quantity: '1', cost: '', costMode: defaultCost }];
    });
    setTimeout(() => { const all = document.querySelectorAll<HTMLInputElement>(`[data-qty="${uid}"]`); const l = all[all.length - 1]; l?.focus(); l?.select(); }, 50);
  }

  async function submitSearch() {
    const text = q.trim();
    if (!text) return;
    // leitor USB: código + Enter → correspondência exata de código de barras/SKU
    const exact = await fetchProducts(`code=${encodeURIComponent(text)}`);
    if (exact.length === 1) { add(exact[0]!); return; }
    const found = await fetchProducts(`q=${encodeURIComponent(text)}`);
    if (found.length === 1) add(found[0]!);
    else if (found.length === 0) setNote(`Nenhum produto ativo encontrado para «${text}».`);
    else { setResults(found); setNote(`${found.length} produtos encontrados: escolha um da lista.`); }
  }

  const onScanned = useCallback(async (code: string) => {
    const exact = await fetchProducts(`code=${encodeURIComponent(code)}`);
    if (exact.length === 1) add(exact[0]!);
    else setNote(`Código «${code}» não corresponde a nenhum produto ativo.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchProducts]);

  const json = useMemo(() => JSON.stringify(lines.map((l) => ({
    product_id: l.p.id, quantity: l.quantity, cost: l.costMode === 'informed' ? l.cost : '', ...(costKind ? { cost_mode: l.costMode } : {}),
  }))), [lines, costKind]);

  const set = (key: string, patch: Partial<Line>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const modes = costKind ? COST_MODES[costKind]! : [];

  return (
    <div className="space-y-3">
      <input type="hidden" name="items" value={json} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <label htmlFor={`${uid}q`} className="mb-1 block text-sm font-medium">Adicionar produto</label>
          <Input id={`${uid}q`} value={q} autoComplete="off" placeholder="Nome, SKU ou código de barras (leitor USB: leia e o Enter adiciona)" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitSearch(); } }} />
        </div>
        <Button type="button" variant="secondary" onClick={() => void submitSearch()}>Adicionar</Button>
        <Button type="button" variant="secondary" onClick={() => setScan((s) => !s)} aria-pressed={scan}>{scan ? 'Fechar câmera' : 'Ler com a câmera'}</Button>
      </div>
      {scan ? <Scanner onCode={(c) => void onScanned(c)} onClose={() => setScan(false)} /> : null}
      <p className="min-h-5 text-xs text-muted" role="status" aria-live="polite">{note}</p>
      {results.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm" aria-label="Resultados da busca">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => add(p)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5">
                <span><span className="font-medium">{p.sku}</span> — {p.name}</span>
                <span className="text-xs text-muted">{p.barcode ? `${p.barcode} · ` : ''}{p.balance !== null ? `saldo ${formatQty(p.balance)} ${p.unit}` : p.unit}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {lines.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Itens da operação</caption>
            <thead><tr className="text-left text-xs uppercase text-muted">
              <th scope="col" className="px-3 py-2">Produto</th>
              {showBalance ? <th scope="col" className="px-3 py-2 text-right">Saldo no depósito</th> : null}
              <th scope="col" className="px-3 py-2">Quantidade</th>
              {costKind ? <th scope="col" className="px-3 py-2">Custo</th> : null}
              <th scope="col" className="px-3 py-2"><span className="sr-only">Remover</span></th>
            </tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const q_ = parseQty(l.quantity, l.p.decimals);
                const over = showBalance && l.p.balance !== null && q_ !== null && Number(q_) > l.p.balance;
                return (
                  <tr key={l.key} className="border-t border-border align-top">
                    <td className="px-3 py-2"><span className="font-medium">{l.p.sku}</span><br /><span className="text-xs text-muted">{l.p.name}</span></td>
                    {showBalance ? <td className={`px-3 py-2 text-right tabular-nums ${over ? 'text-danger' : ''}`}>{l.p.balance === null ? '—' : `${formatQty(l.p.balance)} ${l.p.unit}`}{over ? <span className="block text-xs">acima do saldo</span> : null}</td> : null}
                    <td className="px-3 py-2">
                      <label htmlFor={`${uid}qty${i}`} className="sr-only">Quantidade de {l.p.sku}</label>
                      <div className="flex items-center gap-1">
                        <Input id={`${uid}qty${i}`} data-qty={uid} inputMode="decimal" value={l.quantity} className="w-28 text-right" aria-invalid={q_ === null}
                          onChange={(e) => set(l.key, { quantity: e.target.value })} />
                        <span className="text-xs text-muted">{l.p.unit}</span>
                      </div>
                      {q_ === null && l.quantity !== '' ? <span role="alert" className="text-xs text-danger">{l.p.decimals === 0 ? 'Número inteiro.' : `Até ${l.p.decimals} casas.`}</span> : null}
                    </td>
                    {costKind ? (
                      <td className="px-3 py-2">
                        <label htmlFor={`${uid}cm${i}`} className="sr-only">Política de custo de {l.p.sku}</label>
                        <Select id={`${uid}cm${i}`} value={l.costMode} onChange={(e) => set(l.key, { costMode: e.target.value as CostMode })} className="mb-1 w-56">
                          {modes.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                        </Select>
                        {l.costMode === 'informed' ? (
                          <>
                            <label htmlFor={`${uid}cost${i}`} className="sr-only">Custo unitário de {l.p.sku} em reais</label>
                            <Input id={`${uid}cost${i}`} inputMode="decimal" placeholder="R$ por unidade (12,34)" value={l.cost} className="w-56" onChange={(e) => set(l.key, { cost: e.target.value })} />
                          </>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-right"><Button type="button" variant="ghost" onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))} aria-label={`Remover ${l.p.sku}`}>Remover</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Nenhum item ainda. Busque pelo nome, SKU ou código de barras.</p>}
      {errors?.length ? <p role="alert" className="text-sm text-danger">{errors[0]}</p> : null}
    </div>
  );
}
