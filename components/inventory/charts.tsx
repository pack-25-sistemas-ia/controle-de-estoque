'use client';

import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBRL } from '@/lib/inventory/money';
import { formatQty } from '@/lib/inventory/qty';

// Gráficos só no navegador (ver charts-loader.tsx). Todos os valores vêm do banco; cada gráfico traz uma tabela alternativa acessível.
export type FlowRow = { label: string; entry: number; issue: number; entryOps: number; issueOps: number };
export type NameCents = { name: string; cents: number };
export type BelowRow = { name: string; qty: number; min: number | null; unit: string };
export type LinePoint = { label: string; cents: number };
export type NameValue = { name: string; value: number };
export type TurnRow = { name: string; turnover: number | null; cost: number };
export type AdjRow = { label: string; items: number; cents: number };
export type MoveRow = { label: string; entry: number; issue: number; transfer: number; adjustment: number; count: number; reversal: number };

const GREEN = '#047857';
const RED = '#b91c1c';
const CYAN = '#0e7490';
const SLATE = '#64748b';
const AMBER = '#b45309';
const TICK = { fill: 'currentColor', fontSize: 12 };
const TOOLTIP = { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' };
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 1 });
const tick = (v: number) => compact.format(v / 100); // só rótulo de eixo; os valores exatos ficam na tabela e no tooltip
const money = (v: unknown) => formatBRL(Number(v));
const Grid = () => <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />;

function Frame({ title, description, empty, children, table }: { title: string; description: string; empty: boolean; children: ReactNode; table: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm" aria-label={title}>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{description}</p>
      {empty ? <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted">Sem dados no período selecionado</p> : <div className="h-[260px] w-full text-foreground">{children}</div>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">Ver dados em tabela</summary><div className="mt-2 overflow-x-auto">{table}</div></details>
    </section>
  );
}
const TH = 'px-2 py-1 text-left font-medium text-muted';
const TD = 'px-2 py-1 tabular-nums';
const T = ({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) => (
  <table className="w-full text-xs"><caption className="sr-only">{caption}</caption><thead><tr>{head.map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
);

export function FlowChart({ rows }: { rows: FlowRow[] }) {
  return (
    <Frame title="Entradas × saídas por período" description="Valor gerencial das entradas e custo das saídas (R$). Transferências não entram. A tabela mostra também o número de operações." empty={rows.every((r) => r.entry === 0 && r.issue === 0)}
      table={<T caption="Entradas e saídas por período" head={['Período', 'Entradas (R$)', 'Operações', 'Saídas (custo, R$)', 'Operações']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(r.entry)}</td><td className={TD}>{r.entryOps}</td><td className={TD}>{formatBRL(r.issue)}</td><td className={TD}>{r.issueOps}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={16} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={money} /><Legend />
          <Bar isAnimationActive={false} dataKey="entry" name="Entradas" fill={GREEN} radius={[4, 4, 0, 0]} /><Bar isAnimationActive={false} dataKey="issue" name="Saídas (custo)" fill={RED} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

function HBar({ title, description, rows, caption, fill }: { title: string; description: string; rows: NameCents[]; caption: string; fill: string }) {
  return (
    <Frame title={title} description={description} empty={rows.length === 0}
      table={<T caption={caption} head={['Item', 'Valor (R$)']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{formatBRL(r.cents)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}><Grid /><XAxis type="number" tick={TICK} tickFormatter={tick} /><YAxis type="category" dataKey="name" tick={TICK} width={110} /><Tooltip contentStyle={TOOLTIP} formatter={money} />
          <Bar isAnimationActive={false} dataKey="cents" name="Valor" fill={fill} radius={[0, 4, 4, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}
export const ValueByCategoryChart = ({ rows }: { rows: NameCents[] }) => <HBar title="Valor gerencial por categoria" description="Custo médio × saldo, somado por categoria (não é preço de venda)." rows={rows} caption="Valor por categoria" fill={CYAN} />;
export const WarehouseChart = ({ rows }: { rows: NameCents[] }) => <HBar title="Estoque por depósito" description="Valor gerencial por depósito (distribuição por maior resto: a soma fecha com o total)." rows={rows} caption="Valor por depósito" fill={GREEN} />;
export const TopIssuesChart = ({ rows }: { rows: NameCents[] }) => <HBar title="Produtos com maior saída operacional" description="Custo das saídas por venda e consumo interno no período (transferências, perdas e ajustes ficam de fora)." rows={rows} caption="Maiores saídas" fill={AMBER} />;

export function BelowMinChart({ rows }: { rows: BelowRow[] }) {
  return (
    <Frame title="Produtos abaixo do mínimo" description="Saldo × mínimo dos produtos em nível crítico ou sem estoque (o mais próximo de zero primeiro)." empty={rows.length === 0}
      table={<T caption="Produtos abaixo do mínimo" head={['Produto', 'Saldo', 'Mínimo']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{formatQty(r.qty)} {r.unit}</td><td className={TD}>{r.min === null ? '—' : `${formatQty(r.min)} ${r.unit}`}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} interval={0} tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)} /><YAxis tick={TICK} width={48} /><Tooltip contentStyle={TOOLTIP} /><Legend />
          <Bar isAnimationActive={false} dataKey="qty" name="Saldo" fill={RED} radius={[4, 4, 0, 0]} /><Bar isAnimationActive={false} dataKey="min" name="Mínimo" fill={SLATE} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function ValueEvolutionChart({ rows }: { rows: LinePoint[] }) {
  return (
    <Frame title="Evolução da valorização gerencial" description="Valor do estoque ao fim de cada período (soma acumulada dos valores do livro, a custo médio)." empty={rows.length === 0}
      table={<T caption="Valor do estoque ao longo do tempo" head={['Período', 'Valor (R$)']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(r.cents)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={16} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={money} />
          <Line isAnimationActive={false} type="monotone" dataKey="cents" name="Valor do estoque" stroke={CYAN} strokeWidth={2} dot={false} /></LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function StatusChart({ rows }: { rows: NameValue[] }) {
  return (
    <Frame title="Produtos por situação" description="Normal, atenção e crítico (considera todos os depósitos monitorados); ativos, inativos e arquivados." empty={rows.every((r) => r.value === 0)}
      table={<T caption="Produtos por situação" head={['Situação', 'Produtos']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.value}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} interval={0} /><YAxis tick={TICK} allowDecimals={false} width={40} /><Tooltip contentStyle={TOOLTIP} />
          <Bar isAnimationActive={false} dataKey="value" name="Produtos" fill={CYAN} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function TurnoverChart({ rows }: { rows: TurnRow[] }) {
  return (
    <Frame title="Giro por categoria (em valor)" description="Custo das saídas operacionais ÷ valor médio em estoque no período. Indisponível quando o valor médio é zero." empty={rows.every((r) => r.turnover === null)}
      table={<T caption="Giro por categoria" head={['Categoria', 'Custo das saídas (R$)', 'Giro (vezes)']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{formatBRL(r.cost)}</td><td className={TD}>{r.turnover === null ? 'indisponível' : String(r.turnover).replace('.', ',')}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows.filter((r) => r.turnover !== null)} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} interval={0} tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)} /><YAxis tick={TICK} width={40} /><Tooltip contentStyle={TOOLTIP} />
          <Bar isAnimationActive={false} dataKey="turnover" name="Giro" fill={AMBER} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function CountAdjChart({ rows }: { rows: AdjRow[] }) {
  return (
    <Frame title="Ajustes de inventário" description="Itens ajustados por inventário aprovado e o valor absoluto dos ajustes (R$)." empty={rows.every((r) => r.items === 0)}
      table={<T caption="Ajustes de inventário por período" head={['Período', 'Itens', 'Valor absoluto (R$)']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{r.items}</td><td className={TD}>{formatBRL(r.cents)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={16} /><YAxis tick={TICK} allowDecimals={false} width={40} /><Tooltip contentStyle={TOOLTIP} />
          <Bar isAnimationActive={false} dataKey="items" name="Itens ajustados" fill={SLATE} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function MovesChart({ rows }: { rows: MoveRow[] }) {
  const keys: Array<[keyof Omit<MoveRow, 'label'>, string, string]> = [['entry', 'Entradas', GREEN], ['issue', 'Saídas', RED], ['transfer', 'Transferências', CYAN], ['adjustment', 'Ajustes', AMBER], ['count', 'Inventário', SLATE], ['reversal', 'Estornos', '#7c3aed']];
  return (
    <Frame title="Movimentações por tipo" description="Número de operações por tipo em cada período." empty={rows.every((r) => keys.every(([k]) => r[k] === 0))}
      table={<T caption="Operações por tipo" head={['Período', ...keys.map(([, l]) => l)]}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td>{keys.map(([k]) => <td key={k} className={TD}>{r[k]}</td>)}</tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={16} /><YAxis tick={TICK} allowDecimals={false} width={40} /><Tooltip contentStyle={TOOLTIP} /><Legend />
          {keys.map(([k, l, c]) => <Bar key={k} isAnimationActive={false} stackId="m" dataKey={k} name={l} fill={c} />)}</BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

/** Evolução do saldo de um produto (quantidade). */
export function QtyLineChart({ rows, unit, title }: { rows: Array<{ label: string; qty: number }>; unit: string; title: string }) {
  return (
    <Frame title={title} description={`Saldo total ao fim de cada dia (${unit}).`} empty={rows.length === 0}
      table={<T caption={title} head={['Data', `Saldo (${unit})`]}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatQty(r.qty)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={16} /><YAxis tick={TICK} width={48} /><Tooltip contentStyle={TOOLTIP} />
          <Line isAnimationActive={false} type="stepAfter" dataKey="qty" name="Saldo" stroke={GREEN} strokeWidth={2} dot={false} /></LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}

/** Custo médio de um produto ao longo do tempo (centavos por unidade). */
export function CostLineChart({ rows }: { rows: Array<{ label: string; cents: number }> }) {
  return (
    <Frame title="Histórico do custo médio" description="Custo médio ponderado ao fim de cada dia com movimento (R$ por unidade)." empty={rows.length === 0}
      table={<T caption="Custo médio ao longo do tempo" head={['Data', 'Custo médio (R$)']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(Math.round(r.cents))}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={16} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={money} />
          <Line isAnimationActive={false} type="monotone" dataKey="cents" name="Custo médio" stroke={AMBER} strokeWidth={2} dot={false} /></LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}
