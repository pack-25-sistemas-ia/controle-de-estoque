import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Kpi, Money, Section, TableShell, TD, TH } from '@/components/inventory/bits';
import {
  BelowMinChartClient, CountAdjChartClient, FlowChartClient, MovesChartClient, StatusChartClient, TopIssuesChartClient, TurnoverChartClient, ValueByCategoryChartClient, ValueEvolutionChartClient, WarehouseChartClient,
} from '@/components/inventory/charts-loader';
import { FilterBar } from '@/components/inventory/filter-bar';
import { loadMemberNames, rpc } from '@/lib/inventory/data';
import { loadKpis, loadSeries, shortPeriod, type UnitQty } from '@/lib/inventory/dashboard';
import { resolveFilters, type SearchParams } from '@/lib/inventory/filters';
import { OP_TYPE_LABELS, REASON_LABELS, type OpType } from '@/lib/inventory/labels';
import { formatQty } from '@/lib/inventory/qty';
import { categoryOpts, loadRefs, pageCtx, supplierOpts, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Painel' };

const units = (u: UnitQty[]) => (u.length ? u.map((x) => `${formatQty(x.quantity)} ${x.symbol}`).join(' · ') : '—');

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const f = resolveFilters(sp, p.tz);
  // gera avisos e sugestões do dia (idempotente) para quem pode operar; falha silenciosa não impede o painel
  if (p.perms.operator) await rpc(p.ctx, 'inv_run_routines', { p_org: p.org }).then(() => null, () => null);
  const [refs, members, k, s] = await Promise.all([loadRefs(p.ctx), loadMemberNames(p.ctx), loadKpis(p.ctx, f), loadSeries(p.ctx, f)]);
  const wh = new Map(refs.warehouses.map((w) => [w.id, w.code]));
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  const noData = refs.warehouses.length === 0 || k.products_active === 0;
  const alerts: Array<{ text: string; href: string; tone: 'error' | 'warning' | 'info' }> = [];
  if (k.out_of_stock > 0) alerts.push({ text: `${k.out_of_stock} produto(s) sem estoque`, href: '/saldos?cls=out_of_stock', tone: 'error' });
  if (k.below_minimum > 0) alerts.push({ text: `${k.below_minimum} item(ns) abaixo do mínimo`, href: '/saldos?cls=critical', tone: 'error' });
  if (k.pending_suggestions > 0) alerts.push({ text: `${k.pending_suggestions} sugestão(ões) de reposição aguardando análise`, href: '/reposicao', tone: 'warning' });
  if (k.pending_counts > 0) alerts.push({ text: `${k.pending_counts} inventário(s) em andamento ou aguardando aprovação`, href: '/inventarios', tone: 'warning' });
  if (k.idle_products > 0) alerts.push({ text: `${k.idle_products} produto(s) parado(s) há mais de ${k.idle_days} dias`, href: '/relatorios?r=parados', tone: 'info' });
  if (k.count_divergences > 0) alerts.push({ text: `${k.count_divergences} divergência(s) de inventário no período`, href: '/relatorios?r=inventarios', tone: 'info' });
  const sd = s.status_distribution;
  return (
    <>
      <PageHeader title="Painel de estoque" description={`Período de ${f.from.split('-').reverse().join('/')} a ${f.to.split('-').reverse().join('/')}. Todos os números vêm do banco; quantidades de unidades diferentes nunca são somadas.`}>
        {p.perms.operator ? <div className="flex flex-wrap gap-2 text-sm"><Link className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground" href="/entradas">Registrar entrada</Link><Link className="rounded-md border border-border px-3 py-2" href="/saidas">Registrar saída</Link><Link className="rounded-md border border-border px-3 py-2" href="/transferencias">Transferir</Link></div> : null}
      </PageHeader>
      <FilterBar action="/dashboard" filters={f} warehouses={warehouseOpts(refs.warehouses, true)} categories={categoryOpts(refs.categories)} suppliers={supplierOpts(refs.suppliers)} users={members.map((m) => ({ value: m.user_id, label: m.display_name }))} />

      {noData ? (
        <EmptyState title="Comece cadastrando o estoque" description="Crie um depósito, cadastre produtos (ou importe um CSV) e lance o saldo inicial. Os indicadores aparecem assim que houver movimentações.">
          {p.perms.operator ? <span className="flex flex-wrap justify-center gap-4 text-sm"><Link className="underline" href="/depositos">Depósitos</Link><Link className="underline" href="/produtos">Produtos</Link><Link className="underline" href="/importacoes">Importações</Link></span> : null}
        </EmptyState>
      ) : (
        <>
          {alerts.length ? (
            <div className="mb-6 space-y-2" aria-label="Alertas">{alerts.map((a) => <Alert key={a.text} tone={a.tone}><Link className="underline underline-offset-2" href={a.href}>{a.text}</Link></Alert>)}</div>
          ) : null}

          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Produtos ativos" value={k.products_active} definition="SKUs ativos e não arquivados dentro dos filtros." />
            <Kpi label="Unidades em estoque" value={<span className="text-lg">{units(k.units)}</span>} definition={`${k.skus_with_stock} SKU(s) com saldo. Cada unidade de medida é mostrada separadamente.`} />
            <Kpi label="Valor gerencial do estoque" value={<Money cents={k.stock_value_cents} />} definition="Custo médio × saldo. Não é valor contábil nem preço de venda." />
            <Kpi label="Abaixo do mínimo" value={k.below_minimum} tone={k.below_minimum ? 'danger' : 'neutral'} definition={`Produto × depósito em nível crítico. Mais ${k.attention} em atenção (≤ ponto de reposição).`} />
            <Kpi label="Sem estoque" value={k.out_of_stock} tone={k.out_of_stock ? 'danger' : 'neutral'} definition="Produtos ativos com histórico de movimento e saldo zero." />
            <Kpi label="Entradas no período" value={k.entries.operations} definition={`${units(k.entries.by_unit)} · valor ${(k.entries.value_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`} />
            <Kpi label="Saídas operacionais" value={k.issues.operations} definition={`Venda e consumo interno: ${units(k.issues.by_unit)} · custo ${(k.issues.cost_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Outras saídas (perda, avaria…): ${k.issues.other_operations}.`} />
            <Kpi label="Transferências" value={k.transfers} definition="Movimentações entre depósitos concluídas no período (não entram em entradas nem saídas)." />
            <Kpi label="Produtos parados" value={k.idle_products} definition={`Com saldo e sem saída operacional há mais de ${k.idle_days} dias (produto novo não conta).`} />
            <Kpi label="Divergências de inventário" value={k.count_divergences} definition="Itens com diferença entre contado e esperado em inventários concluídos no período." />
            <Kpi label="Cobertura (mediana)" value={k.coverage_days_median === null ? '—' : `${String(Math.round(k.coverage_days_median * 10) / 10).replace('.', ',')} dias`} definition={k.coverage_days_median === null ? 'Indisponível: precisa de produtos com ao menos 3 dias de saída na janela de cobertura.' : `Mediana de ${k.coverage_products} produto(s) com consumo observado.`} />
            <Kpi label="Ajustes no período" value={k.adjustments.operations} definition={`Valor absoluto ajustado: ${(k.adjustments.abs_value_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Inclui só ajustes manuais; inventários aparecem em «Divergências».`} />
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <FlowChartClient rows={s.flow.map((r) => ({ label: shortPeriod(r.period, s.step), entry: r.entry_value_cents, issue: r.issue_value_cents, entryOps: r.entry_ops, issueOps: r.issue_ops }))} />
            <ValueEvolutionChartClient rows={s.value_evolution.map((r) => ({ label: shortPeriod(r.period, s.step), cents: r.value_cents }))} />
            <ValueByCategoryChartClient rows={s.value_by_category.map((r) => ({ name: r.category, cents: r.value_cents }))} />
            <WarehouseChartClient rows={s.stock_by_warehouse.map((r) => ({ name: r.code, cents: r.value_cents }))} />
            <BelowMinChartClient rows={s.below_minimum.map((r) => ({ name: r.sku, qty: r.quantity, min: r.minimum, unit: r.unit }))} />
            <TopIssuesChartClient rows={s.top_issues.map((r) => ({ name: r.sku, cents: r.cost_cents }))} />
            <StatusChartClient rows={[{ name: 'Normal', value: sd.normal }, { name: 'Atenção', value: sd.attention }, { name: 'Crítico', value: sd.critical }, { name: 'Inativos', value: sd.inactive }, { name: 'Arquivados', value: sd.archived }]} />
            <TurnoverChartClient rows={s.turnover_by_category.map((r) => ({ name: r.category, turnover: r.turnover, cost: r.cost_cents }))} />
            <CountAdjChartClient rows={s.count_adjustments.map((r) => ({ label: shortPeriod(r.period, s.step), items: r.items, cents: r.abs_value_cents }))} />
            <MovesChartClient rows={s.movements_by_type.map((r) => ({ label: shortPeriod(r.period, s.step), entry: r.entry, issue: r.issue, transfer: r.transfer, adjustment: r.adjustment, count: r.count, reversal: r.reversal }))} />
          </div>

          <Section title="Movimentações recentes" description="Últimas operações do período (dentro dos filtros)." actions={<Link className="text-sm underline underline-offset-2" href="/movimentacoes">Histórico completo</Link>}>
            <TableShell caption="Movimentações recentes" empty={k.recent_operations.length === 0} emptyText="Nenhuma operação no período.">
              <thead><tr className="border-b border-border"><th scope="col" className={TH}>Nº</th><th scope="col" className={TH}>Data</th><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Depósito</th><th scope="col" className={TH}>Itens</th><th scope="col" className={TH}>Referência</th><th scope="col" className={TH}>Responsável</th><th scope="col" className={TH}>Situação</th></tr></thead>
              <tbody>{k.recent_operations.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0">
                  <td className={`${TD} tabular-nums`}><Link className="underline underline-offset-2" href={`/movimentacoes/${o.id}`}>{o.number}</Link></td>
                  <td className={TD}><DateTimeBR value={o.at} tz={p.tz} /></td>
                  <td className={TD}>{OP_TYPE_LABELS[o.type as OpType] ?? o.type}{o.reason ? <span className="block text-xs text-muted">{REASON_LABELS[o.reason] ?? o.reason}</span> : null}</td>
                  <td className={TD}>{wh.get(o.warehouse_id ?? '') ?? '—'}{o.destination_id ? ` → ${wh.get(o.destination_id) ?? '?'}` : ''}</td>
                  <td className={`${TD} tabular-nums`}>{o.items}</td><td className={TD}>{o.reference ?? '—'}</td><td className={TD}>{who.get(o.user_id) ?? '—'}</td>
                  <td className={TD}>{o.status === 'reversed' ? <Badge tone="warning">Estornada</Badge> : <Badge tone="success">Confirmada</Badge>}</td>
                </tr>
              ))}</tbody>
            </TableShell>
          </Section>
        </>
      )}
    </>
  );
}
