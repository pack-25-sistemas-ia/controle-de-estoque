// Quantidades e custos unitários. NUNCA número binário: texto decimal validado aqui e conferido de novo no banco (numeric).
// O banco é quem decide (escala da unidade, limites, saldo); este módulo só normaliza a digitação brasileira e formata para exibição.
import Decimal from 'decimal.js';

export const MAX_QTY = new Decimal('999999999999.999');
export const MAX_UNIT_COST_CENTS = new Decimal('99999999999999');

const THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

/**
 * Digitação brasileira → texto decimal com ponto («1.234,5» → «1234.5»).
 * Com vírgula: a vírgula é o decimal e o ponto é milhar. Só com ponto: em unidade sem casas (decimals = 0) o ponto é milhar;
 * em unidade fracionária o ponto é decimal («1.234» kg = 1,234 kg). Devolve null se inválido, acima do limite, com mais casas que a unidade
 * permite, ou menor/igual a zero (quando allowZero = false).
 */
export function parseQty(input: string, decimals: number, opts: { allowZero?: boolean } = {}): string | null {
  let s = input.trim().replace(/\s/g, '');
  if (s === '' || /[^0-9.,]/.test(s)) return null;
  if (s.includes(',')) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replaceAll('.', '').replace(',', '.');
  } else if (s.includes('.')) {
    if (decimals === 0) { if (!THOUSANDS.test(s)) return null; s = s.replaceAll('.', ''); }
    else if ((s.match(/\./g) ?? []).length > 1) { if (!THOUSANDS.test(s)) return null; s = s.replaceAll('.', ''); }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const d = new Decimal(s);
  if (d.decimalPlaces() > decimals) return null;
  if (d.gt(MAX_QTY) || (d.lte(0) && !opts.allowZero) || d.lt(0)) return null;
  return d.toFixed(decimals === 0 ? 0 : d.decimalPlaces());
}

/** Exibição pt-BR: sem zeros à direita, até 3 casas. */
export function formatQty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(n);
}

/**
 * Custo unitário digitado em REAIS («12,34», «0,0125») → centavos como texto («1234», «1.25»), com até 4 casas de reais.
 * O banco aceita até 4 casas de centavo; aqui 4 casas de reais já cabem nisso.
 */
export function parseUnitCostCents(input: string): string | null {
  let s = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (s === '' || /[^0-9.,]/.test(s)) return null;
  if (s.includes(',')) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replaceAll('.', '').replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1 || (s.includes('.') && THOUSANDS.test(s))) {
    if (!THOUSANDS.test(s)) return null;
    s = s.replaceAll('.', '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const reais = new Decimal(s);
  if (reais.decimalPlaces() > 4) return null;
  const cents = reais.mul(100);
  if (cents.gt(MAX_UNIT_COST_CENTS) || cents.lt(0)) return null;
  return cents.toString();
}

/** Centavos (inteiro ou com fração) → «R$ 12,34»; frações de centavo aparecem quando existem («R$ 0,0125»). */
export function formatUnitCost(cents: string | number | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') return '—';
  const reais = new Decimal(cents).div(100);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(reais.toNumber());
}

/** Valor da linha (centavos inteiros) = quantidade × custo unitário, meio-para-o-par — espelho de `private.inv_entry_value` para a prévia. */
export function lineValueCents(qty: string, unitCostCents: string): number | null {
  try {
    const v = new Decimal(qty).mul(unitCostCents).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
    return v.gt(99_999_999_999_999) ? null : v.toNumber();
  } catch { return null; }
}
