'use client';

import dynamic from 'next/dynamic';

// Gráficos só no navegador: a biblioteca gera estilos em linha, que a CSP estrita bloquearia no HTML do servidor.
// (O Next exige que as opções do `dynamic` sejam um objeto literal, por isso se repetem.)
function Skeleton() {
  return (
    <div role="status" className="h-[330px] animate-pulse rounded-lg bg-black/10 dark:bg-white/10">
      <span className="sr-only">Carregando gráfico…</span>
    </div>
  );
}

export const FlowChartClient = dynamic(() => import('./charts').then((m) => m.FlowChart), { ssr: false, loading: Skeleton });
export const ValueByCategoryChartClient = dynamic(() => import('./charts').then((m) => m.ValueByCategoryChart), { ssr: false, loading: Skeleton });
export const WarehouseChartClient = dynamic(() => import('./charts').then((m) => m.WarehouseChart), { ssr: false, loading: Skeleton });
export const TopIssuesChartClient = dynamic(() => import('./charts').then((m) => m.TopIssuesChart), { ssr: false, loading: Skeleton });
export const BelowMinChartClient = dynamic(() => import('./charts').then((m) => m.BelowMinChart), { ssr: false, loading: Skeleton });
export const ValueEvolutionChartClient = dynamic(() => import('./charts').then((m) => m.ValueEvolutionChart), { ssr: false, loading: Skeleton });
export const StatusChartClient = dynamic(() => import('./charts').then((m) => m.StatusChart), { ssr: false, loading: Skeleton });
export const TurnoverChartClient = dynamic(() => import('./charts').then((m) => m.TurnoverChart), { ssr: false, loading: Skeleton });
export const CountAdjChartClient = dynamic(() => import('./charts').then((m) => m.CountAdjChart), { ssr: false, loading: Skeleton });
export const MovesChartClient = dynamic(() => import('./charts').then((m) => m.MovesChart), { ssr: false, loading: Skeleton });
export const QtyLineChartClient = dynamic(() => import('./charts').then((m) => m.QtyLineChart), { ssr: false, loading: Skeleton });
export const CostLineChartClient = dynamic(() => import('./charts').then((m) => m.CostLineChart), { ssr: false, loading: Skeleton });
