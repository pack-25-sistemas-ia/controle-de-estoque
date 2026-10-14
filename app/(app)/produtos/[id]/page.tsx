import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { AttachmentPanel } from '@/components/inventory/attachments';
import { ArchiveProductForm, DeleteRuleForm, LinkSupplierForm, ProductForm, RuleForm, UnlinkSupplierForm } from '@/components/inventory/catalog-forms';
import { ClassBadge, DateBR, DateTimeBR, Disclosure, Kpi, Money, Qty, Section, TableShell, TD, TDR, TH, THR } from '@/components/inventory/bits';
import { CostLineChartClient, QtyLineChartClient } from '@/components/inventory/charts-loader';
import { loadAttachments, loadMemberNames, loadMovements, loadProduct, loadProductSuppliers, loadRules } from '@/lib/inventory/data';
import { loadProductStats, shortPeriod } from '@/lib/inventory/dashboard';
import { addDays } from '@/lib/inventory/dates';
import { uuidOrNull } from '@/lib/inventory/filters';
import { MOVE_TYPE_LABELS, PRODUCT_TYPE_LABELS, REASON_LABELS, type ProductType, type StockClass } from '@/lib/inventory/labels';
import { formatUnitCost } from '@/lib/inventory/qty';
import { categoryOpts, loadRefs, pageCtx, supplierOpts, unitOpts, warehouseOpts } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Produto' };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = uuidOrNull(raw);
  if (!id) notFound();
  const p = await pageCtx();
  const product = await loadProduct(p.ctx, id);
  if (!product) notFound();
  const refs = await loadRefs(p.ctx);
  const unit = refs.units.find((u) => u.id === product.unit_id);
  const from = addDays(p.today, -89);
  const [stats, mv, links, rules, images, members] = await Promise.all([
    loadProductStats(p.ctx, id, from, p.today), loadMovements(p.ctx, p.tz, { product: id, limit: 15 }), loadProductSuppliers(p.ctx, id), loadRules(p.ctx, id),
    loadAttachments(p.ctx, 'product_image', id), loadMemberNames(p.ctx),
  ]);
  const whName = new Map(refs.warehouses.map((w) => [w.id, w.code]));
  const supName = new Map(refs.suppliers.map((s) => [s.id, s.name]));
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  const u = unit?.symbol ?? '';
  const image = images[0];
  return (
    <>
      <PageHeader title={`${product.sku} — ${product.name}`} description={`${PRODUCT_TYPE_LABELS[product.product_type as ProductType] ?? product.product_type} · unidade ${unit?.name ?? '—'} (${unit?.decimal_places ?? 0} casa(s) decimal(is))`}>
        <div className="flex flex-wrap items-center gap-2">
          {product.archived_at ? <Badge>Arquivado</Badge> : product.status === 'inactive' ? <Badge tone="warning">Inativo</Badge> : <Badge tone="success">Ativo</Badge>}
          <Link className="text-sm underline underline-offset-2" href={`/etiquetas?p=${id}`}>Imprimir etiqueta</Link>
          <Link className="text-sm underline underline-offset-2" href="/produtos">Voltar</Link>
        </div>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Saldo físico" value={<Qty value={stats.quantity} unit={u} />} definition="Soma dos movimentos do produto em todos os depósitos." />
        <Kpi label="Disponível" value={<Qty value={stats.quantity} unit={u} />} definition="Físico − reservado. Este sistema não usa reservas: disponível = físico." />
        <Kpi label="Custo médio" value={stats.average_cost_cents === null ? '—' : formatUnitCost(stats.average_cost_cents)} definition="Valor gerencial ÷ quantidade (média ponderada móvel). Não é preço de venda nem valor contábil." />
        <Kpi label="Valor gerencial" value={<Money cents={stats.value_cents} />} definition="Valor acumulado do estoque pelo custo médio." />
        <Kpi label="Entradas (90 dias)" value={<Qty value={stats.entries_period} unit={u} />} definition="Quantidade recebida por entradas no período." />
        <Kpi label="Saídas operacionais (90 dias)" value={<Qty value={stats.operational_issues_period} unit={u} />} definition="Vendas e consumo interno. Perdas, avarias e transferências ficam de fora." />
        <Kpi label="Última entrada / saída" value={<span className="text-base"><DateBR value={stats.last_entry_at} /> / <DateBR value={stats.last_issue_at} /></span>} definition="Datas dos movimentos mais recentes." />
        <Kpi label="Cobertura" value={stats.coverage_days === null ? '—' : `${String(stats.coverage_days).replace('.', ',')} dias`} definition={stats.coverage_days === null ? `Indisponível: ${stats.coverage_note ?? 'sem dados suficientes'}.` : 'Saldo ÷ consumo médio diário da janela configurada (observado, não previsão).'} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <QtyLineChartClient title="Evolução do saldo (90 dias)" unit={u} rows={stats.balance_series.map((r) => ({ label: shortPeriod(r.date, 'day'), qty: r.quantity }))} />
        <CostLineChartClient rows={stats.cost_series.map((r) => ({ label: shortPeriod(r.date, 'day'), cents: r.average_cost_cents }))} />
      </div>

      <Section title="Saldo por depósito">
        <TableShell caption="Saldo por depósito" empty={stats.by_warehouse.length === 0} emptyText="Este produto ainda não tem movimentação.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Depósito</th><th scope="col" className={THR}>Saldo</th><th scope="col" className={THR}>Valor</th><th scope="col" className={THR}>Mínimo</th><th scope="col" className={THR}>Ponto de reposição</th><th scope="col" className={THR}>Alvo</th><th scope="col" className={TH}>Situação</th></tr></thead>
          <tbody>{stats.by_warehouse.map((w) => (
            <tr key={w.warehouse_id} className="border-b border-border last:border-0">
              <td className={TD}>{w.code} · {w.name}</td><td className={TDR}><Qty value={w.quantity} unit={u} /></td><td className={TDR}><Money cents={w.value_cents} /></td>
              <td className={TDR}>{w.minimum === null ? '—' : <Qty value={w.minimum} />}</td><td className={TDR}>{w.reorder_point === null ? '—' : <Qty value={w.reorder_point} />}</td><td className={TDR}>{w.target === null ? '—' : <Qty value={w.target} />}</td>
              <td className={TD}><ClassBadge cls={w.class as StockClass} /></td>
            </tr>
          ))}</tbody>
        </TableShell>
      </Section>

      <Section title="Últimos movimentos" actions={<Link className="text-sm underline underline-offset-2" href="/movimentacoes">Histórico completo</Link>}>
        <TableShell caption="Últimos movimentos do produto" empty={mv.rows.length === 0} emptyText="Nenhum movimento.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Data</th><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Depósito</th><th scope="col" className={THR}>Quantidade</th><th scope="col" className={THR}>Saldo após</th><th scope="col" className={THR}>Valor</th><th scope="col" className={TH}>Responsável</th><th scope="col" className={TH}><span className="sr-only">Operação</span></th></tr></thead>
          <tbody>{mv.rows.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              <td className={TD}><DateTimeBR value={m.occurred_at} tz={p.tz} /></td>
              <td className={TD}>{MOVE_TYPE_LABELS[m.movement_type] ?? m.movement_type}{m.reason_code ? <span className="block text-xs text-muted">{REASON_LABELS[m.reason_code] ?? m.reason_code}</span> : null}</td>
              <td className={TD}>{whName.get(m.warehouse_id) ?? '—'}</td><td className={TDR}><Qty value={m.quantity_delta} unit={u} signed /></td><td className={TDR}><Qty value={m.balance_after} unit={u} /></td>
              <td className={TDR}><Money cents={m.value_delta_cents} signed /></td><td className={TD}>{who.get(m.performed_by) ?? '—'}</td>
              <td className={TD}><Link className="underline underline-offset-2" href={`/movimentacoes/${m.operation_id}`}>Abrir</Link></td>
            </tr>
          ))}</tbody>
        </TableShell>
      </Section>

      <Section title="Fornecedores">
        {links.length ? (
          <ul className="mb-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>{supName.get(l.supplier_id) ?? '—'}{l.is_preferred ? <Badge tone="success"> preferencial</Badge> : null}<span className="ml-2 text-xs text-muted">{l.supplier_sku ? `SKU ${l.supplier_sku} · ` : ''}{l.lead_time_days !== null ? `prazo ${l.lead_time_days} dia(s)` : 'sem prazo informado'}</span></span>
                {p.perms.manager ? <UnlinkSupplierForm id={l.id} productId={id} /> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mb-3 text-sm text-muted">Nenhum fornecedor associado. {product.default_supplier_id ? `Fornecedor principal: ${supName.get(product.default_supplier_id)}.` : ''}</p>}
        {p.perms.manager ? <Disclosure summary="Associar fornecedor"><LinkSupplierForm productId={id} suppliers={supplierOpts(refs.suppliers)} /></Disclosure> : null}
      </Section>

      <Section title="Regras de reposição" description="O padrão do cadastro vale para todos os depósitos; uma regra por depósito tem prioridade.">
        {rules.length ? (
          <ul className="mb-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>{r.warehouse_id ? (whName.get(r.warehouse_id) ?? '—') : 'Padrão do produto'}: mínimo {r.minimum_quantity} · ponto {r.reorder_point} · alvo {r.target_quantity ?? '—'}</span>
                {p.perms.manager ? <DeleteRuleForm id={r.id} /> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mb-3 text-sm text-muted">Sem regras específicas: vale o cadastro (mínimo {product.minimum_stock ?? '—'} · ponto {product.reorder_point ?? '—'} · alvo {product.target_stock ?? '—'}).</p>}
        {p.perms.manager ? <Disclosure summary="Definir regra"><RuleForm productId={id} warehouses={warehouseOpts(refs.warehouses, true)} /></Disclosure> : null}
      </Section>

      <Section title="Imagem e etiqueta">
        <Card className="p-4">
          {/* <img> e não next/image: o next/image injeta style="color:transparent", bloqueado pela CSP estrita. A imagem vem do próprio domínio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image ? <img src={`/api/attachments/${image.id}?inline=1`} alt={`Imagem de ${product.name}`} width={160} height={160} className="mb-3 size-40 rounded-md border border-border object-contain" /> : <p className="mb-3 text-sm text-muted">Sem imagem.</p>}
          <AttachmentPanel entityType="product_image" entityId={id} items={images} canUpload={p.perms.operator && !product.archived_at && images.length === 0} />
        </Card>
      </Section>

      {p.perms.operator ? (
        <Section title="Editar cadastro">
          <Disclosure summary="Editar produto">
            <ProductForm product={product} categories={categoryOpts(refs.categories)} units={unitOpts(refs.units)} suppliers={supplierOpts(refs.suppliers)} canParams={p.perms.manager} />
          </Disclosure>
          {p.perms.manager ? <div className="mt-3"><Disclosure summary={product.archived_at ? 'Reativar produto' : 'Arquivar produto'} tone="danger"><ArchiveProductForm id={id} archived={Boolean(product.archived_at)} /></Disclosure></div> : null}
        </Section>
      ) : null}
    </>
  );
}
