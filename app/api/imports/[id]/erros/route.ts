import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { toCsv, type CsvValue } from '@/lib/inventory/csv';
import { rateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deny = (status: number, msg: string) => new NextResponse(msg, { status, headers: { 'Cache-Control': 'no-store' } });
const STATUS: Record<string, string> = { error: 'Erro', duplicate: 'Repetida' };

/** Relatório de erros da importação (CSV protegido contra fórmulas). Quem importa (operador+) pode baixar; o dado vem pela RLS da empresa. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolveContext(['owner', 'admin', 'manager', 'member']);
  if (r.kind === 'redirect') return deny(401, 'Sessão expirada.');
  if (r.kind !== 'ok') return deny(403, 'Sem permissão.');
  if (!UUID.test(id)) return deny(404, 'Não encontrado.');
  const { ctx } = r;
  const rl = rateLimit(`imperr:${ctx.user.id}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return deny(429, 'Muitas requisições.');
  const org = ctx.membership.organization_id;
  const { data: job } = await ctx.supabase.from('import_jobs').select('id').eq('organization_id', org).eq('id', id).maybeSingle();
  if (!job) return deny(404, 'Não encontrado.');
  const { data } = await ctx.supabase.from('import_rows').select('row_number, status, error_message, natural_key').eq('organization_id', org).eq('job_id', id).in('status', ['error', 'duplicate']).order('row_number').limit(5000);
  const rows: CsvValue[][] = (data ?? []).map((x) => [x.row_number as number, STATUS[x.status as string] ?? (x.status as string), (x.error_message as string | null) ?? '', (x.natural_key as string | null) ?? '']);
  return new NextResponse(toCsv(['Linha do arquivo', 'Situação', 'Motivo', 'Chave'], rows), { status: 200, headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="erros-importacao-${id.slice(0, 8)}.csv"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
