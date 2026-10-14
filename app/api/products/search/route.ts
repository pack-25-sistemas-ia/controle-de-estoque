import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { safeSearch } from '@/lib/inventory/filters';
import { rateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Busca de produtos para os editores de itens e para o leitor de código de barras.
 *   ?q=texto   → até 15 produtos ativos por nome/SKU/código (parcial)
 *   ?code=...  → correspondência EXATA de código de barras ou SKU (leitor USB/câmera)
 * Passa pela RLS: só os produtos da empresa do usuário. Com `wh`, devolve também o saldo daquele depósito.
 */
export async function GET(request: Request) {
  const r = await resolveContext();
  if (r.kind !== 'ok') return json({ ok: false, items: [] }, 401);
  const { ctx } = r;
  const rl = rateLimit(`psearch:${ctx.user.id}`, { limit: 240, windowMs: 60_000 });
  if (!rl.allowed) return json({ ok: false, items: [], message: 'Muitas buscas em pouco tempo.' }, 429);
  const url = new URL(request.url);
  const org = ctx.membership.organization_id;
  const code = (url.searchParams.get('code') ?? '').trim().slice(0, 60);
  const q = safeSearch(url.searchParams.get('q') ?? undefined);
  const wh = url.searchParams.get('wh');
  if (!code && !q) return json({ ok: true, items: [] });

  let query = ctx.supabase.from('products').select('id, sku, name, barcode, unit_id, status').eq('organization_id', org).is('archived_at', null).eq('status', 'active').order('name').limit(15);
  if (code) {
    if (!/^[A-Za-z0-9._/-]{1,48}$/.test(code)) return json({ ok: true, items: [] });
    // igualdade exata (o «_» de LIKE seria curinga); tenta o texto como veio e em maiúsculas
    const up = code.toUpperCase();
    query = query.or(`barcode.eq.${code},sku.eq.${code},barcode.eq.${up},sku.eq.${up}`);
  } else if (q) {
    query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`);
  }
  const { data, error } = await query;
  if (error) return json({ ok: false, items: [] }, 500);
  const rows = data ?? [];
  const unitIds = [...new Set(rows.map((x) => x.unit_id as string))];
  const [units, bal] = await Promise.all([
    unitIds.length ? ctx.supabase.from('units_of_measure').select('id, symbol, decimal_places').in('id', unitIds) : Promise.resolve({ data: [] as Array<{ id: string; symbol: string; decimal_places: number }> }),
    wh && /^[0-9a-f-]{36}$/i.test(wh) && rows.length ? ctx.supabase.from('inventory_balances').select('product_id, quantity_on_hand').eq('organization_id', org).eq('warehouse_id', wh).in('product_id', rows.map((x) => x.id as string)) : Promise.resolve({ data: [] as Array<{ product_id: string; quantity_on_hand: number }> }),
  ]);
  const um = new Map((units.data ?? []).map((u) => [u.id as string, u]));
  const bm = new Map((bal.data ?? []).map((b) => [b.product_id as string, Number(b.quantity_on_hand)]));
  return json({
    ok: true,
    items: rows.map((x) => ({ id: x.id, sku: x.sku, name: x.name, barcode: x.barcode, unit: um.get(x.unit_id as string)?.symbol ?? '', decimals: um.get(x.unit_id as string)?.decimal_places ?? 0, balance: wh ? (bm.get(x.id as string) ?? 0) : null })),
  });
}
