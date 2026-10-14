'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button, Select } from '@/components/ui/primitives';
import { checkBarcode } from '@/lib/inventory/barcode';
import { formatBRL } from '@/lib/inventory/money';

export type LabelItem = { sku: string; name: string; barcode: string | null; priceCents: number | null; copies: number };
const SIZES = { small: { label: '50 × 25 mm', cls: 'w-[50mm] h-[25mm]', bar: 38 }, medium: { label: '60 × 40 mm', cls: 'w-[60mm] h-[40mm]', bar: 60 }, large: { label: '100 × 50 mm', cls: 'w-[100mm] h-[50mm]', bar: 80 } } as const;
type SizeKey = keyof typeof SIZES;

function Bars({ code, height }: { code: string; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const c = checkBarcode(code);
  const kind = c.ok ? c.kind : null;
  useEffect(() => {
    if (!kind) return;
    let alive = true;
    void import('jsbarcode').then((m) => {
      if (!alive || !ref.current) return;
      try {
        const JsBarcode = m.default;
        // canvas (e não SVG): o SVG do JsBarcode usa atributo style, que a CSP estrita bloqueia
        JsBarcode(ref.current, code, { format: kind === 'UPCA' ? 'UPC' : kind, displayValue: true, fontSize: 12, height, margin: 2, width: 1.6, background: '#ffffff', lineColor: '#000000' });
      } catch { /* código não desenhável: o texto abaixo continua legível */ }
    });
    return () => { alive = false; };
  }, [code, height, kind]);
  return !c.ok ? <p role="alert" className="text-[10px] text-danger">{c.message}</p> : <canvas ref={ref} role="img" aria-label={`Código de barras ${code}`} className="max-w-full" />;
}

/** Folha de etiquetas: o navegador imprime só a área das etiquetas. O código é o do cadastro (EAN/UPC reais ou código interno); nada é «oficial» por ser impresso aqui. */
export function LabelSheet({ items, company, showCompany, showPrice }: { items: LabelItem[]; company: string; showCompany: boolean; showPrice: boolean }) {
  const p = useId();
  const [size, setSize] = useState<SizeKey>('medium');
  const s = SIZES[size];
  const labels = items.flatMap((i) => Array.from({ length: Math.min(Math.max(i.copies, 1), 200) }, (_, n) => ({ ...i, key: `${i.sku}-${n}` })));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label htmlFor={`${p}sz`} className="mb-1 block text-xs font-medium text-muted">Tamanho da etiqueta</label>
          <Select id={`${p}sz`} value={size} onChange={(e) => setSize(e.target.value as SizeKey)} className="w-44">{Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        </div>
        <Button type="button" onClick={() => window.print()}>Imprimir {labels.length} etiqueta(s)</Button>
        <p className="text-xs text-muted">Na janela de impressão, desative cabeçalhos e rodapés e use a escala 100%.</p>
      </div>
      <div className="flex flex-wrap gap-2 print:gap-0">
        {labels.map((l) => (
          <div key={l.key} className={`${s.cls} flex shrink-0 flex-col items-center justify-between overflow-hidden rounded border border-dashed border-border bg-white p-1 text-center text-black print:break-inside-avoid print:border-0`}>
            {showCompany && company ? <span className="w-full truncate text-[8px] leading-tight text-neutral-700">{company}</span> : null}
            <span className="line-clamp-2 w-full text-[10px] font-medium leading-tight">{l.name}</span>
            <span className="text-[9px] leading-tight">SKU {l.sku}{showPrice && l.priceCents !== null ? ` · ${formatBRL(l.priceCents)}` : ''}</span>
            {l.barcode ? <Bars code={l.barcode} height={s.bar} /> : <span className="text-[9px] text-neutral-600">sem código de barras</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
