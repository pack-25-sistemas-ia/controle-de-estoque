// Filtros vindos da URL (a URL é a fonte: compartilhável e funciona sem JavaScript). Tudo validado; valor inválido cai no padrão.
import { addDays, isIsoDate, monthRange, todayIn } from './dates';

export const PERIODS = ['today', '7d', '30d', '90d', 'month', 'year', 'custom'] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias', month: 'Mês atual', year: 'Ano atual', custom: 'Período personalizado',
};

export type SearchParams = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOrNull = (v: string | undefined): string | null => (v && UUID.test(v) ? v.toLowerCase() : null);

export type Filters = {
  period: Period; from: string; to: string; warehouse: string | null; category: string | null; supplier: string | null; product: string | null; user: string | null; type: string | null;
};

export function resolveFilters(sp: SearchParams, timeZone: string, now: number = Date.now()): Filters {
  const today = todayIn(timeZone, now);
  const raw = one(sp.period);
  const period: Period = (PERIODS as readonly string[]).includes(raw ?? '') ? (raw as Period) : '30d';
  let from = today;
  let to = today;
  switch (period) {
    case '7d': from = addDays(today, -6); break;
    case '30d': from = addDays(today, -29); break;
    case '90d': from = addDays(today, -89); break;
    case 'month': ({ from, to } = monthRange(today)); break;
    case 'year': from = `${today.slice(0, 4)}-01-01`; to = `${today.slice(0, 4)}-12-31`; break;
    case 'custom': {
      const f = one(sp.from);
      const t = one(sp.to);
      if (f && t && isIsoDate(f) && isIsoDate(t) && f <= t && (Date.parse(t) - Date.parse(f)) / 86_400_000 <= 366) { from = f; to = t; } else { from = addDays(today, -29); }
      break;
    }
    default: break;
  }
  // o banco aceita no máximo 367 dias por consulta
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) from = addDays(to, -366);
  return {
    period, from, to, warehouse: uuidOrNull(one(sp.wh)), category: uuidOrNull(one(sp.category)), supplier: uuidOrNull(one(sp.supplier)), product: uuidOrNull(one(sp.product)),
    user: uuidOrNull(one(sp.user)), type: one(sp.type) ?? null,
  };
}

/** Texto de busca seguro para `ilike`: remove curingas e separadores do PostgREST. */
export function safeSearch(v: string | undefined): string | null {
  const s = (v ?? '').replace(/[%_,()*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s.length >= 2 ? s : null;
}

export const PAGE_SIZE = 20;
export function pageFrom(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}

/** Monta uma URL preservando os filtros atuais e alterando alguns. */
export function withParams(base: string, current: SearchParams, changes: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const s = one(v);
    if (s !== undefined && s !== '' && !(k in changes)) q.set(k, s);
  }
  for (const [k, v] of Object.entries(changes)) if (v !== null && v !== '') q.set(k, v);
  const str = q.toString();
  return str ? `${base}?${str}` : base;
}

/** true para «AAAA-MM-DD» válido (usado em filtros de lista, onde valor ruim é simplesmente ignorado). */
export function isIsoDateLoose(v: string | undefined): boolean {
  return typeof v === 'string' && isIsoDate(v);
}
