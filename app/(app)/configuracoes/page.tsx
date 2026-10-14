import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { Disclosure, Section } from '@/components/inventory/bits';
import { SettingsForm, UnitForm, UnitRowForm } from '@/components/inventory/catalog-forms';
import { loadUnits } from '@/lib/inventory/data';
import { pageCtx } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Config. de estoque' };

export default async function ConfiguracoesPage() {
  const p = await pageCtx();
  const units = await loadUnits(p.ctx);
  return (
    <>
      <PageHeader title="Configurações de estoque" description="Regras de operação da empresa. Identidade visual, equipe e privacidade ficam em Configurações, Equipe e Privacidade." />
      <Section title="Regras fixas do sistema">
        <Card className="space-y-2 p-4 text-sm">
          <p><strong>Estoque negativo:</strong> bloqueado sempre. Não há opção para liberar, porque o custo médio e o inventário dependem de saldo nunca negativo.</p>
          <p><strong>Custo:</strong> custo médio ponderado móvel por produto, em centavos. É um valor gerencial, não contábil nem fiscal.</p>
          <p><strong>Histórico:</strong> movimentos confirmados não são editados nem apagados; correções são estornos.</p>
          <p><strong>Reservas:</strong> fora desta versão (disponível = físico).</p>
        </Card>
      </Section>
      <Section title="Parâmetros de análise" description="Usados nos indicadores de produtos parados e de cobertura.">
        {p.perms.admin ? <SettingsForm settings={p.settings} /> : (
          <Card className="p-4 text-sm"><p>Produto parado após <strong>{p.settings.idle_days}</strong> dias sem saída operacional. Cobertura pela média dos últimos <strong>{p.settings.coverage_window_days}</strong> dias.</p><p className="mt-2 text-muted">Somente o administrador altera estes parâmetros.</p></Card>
        )}
      </Section>
      <Section title="Unidades de medida" description="O número de casas decimais define a precisão das quantidades e não pode mudar depois de criado (nem trocar a unidade de um produto que já tem movimentos).">
        {p.perms.manager ? <div className="mb-4"><Disclosure summary="Nova unidade"><UnitForm /></Disclosure></div> : null}
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {units.map((u) => (
            <li key={u.id} className="px-3 py-3">
              {p.perms.manager ? <UnitRowForm unit={u} /> : <p className="text-sm">{u.name} ({u.symbol}) — {u.decimal_places} casa(s) decimal(is){u.active ? '' : ' · inativa'}</p>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Mais">
        <Alert tone="info">Depósitos e depósitos autorizados por operador estão em <Link className="underline" href="/depositos">Depósitos</Link>; categorias em <Link className="underline" href="/categorias">Categorias</Link>.</Alert>
      </Section>
    </>
  );
}
