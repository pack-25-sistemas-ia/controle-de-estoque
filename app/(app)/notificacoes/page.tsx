import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Disclosure, Section } from '@/components/inventory/bits';
import { MarkReadForm, PrefForm } from '@/components/inventory/count-forms';
import { loadNotificationPrefs, loadNotifications } from '@/lib/inventory/data';
import { NOTIFICATION_LABELS, NOTIFICATION_TYPES } from '@/lib/inventory/labels';
import { pageCtx } from '@/lib/inventory/page';

export const metadata: Metadata = { title: 'Avisos' };

export default async function NotificacoesPage() {
  const p = await pageCtx();
  const [list, prefs] = await Promise.all([loadNotifications(p.ctx), loadNotificationPrefs(p.ctx)]);
  const unread = list.filter((n) => !n.read_at).length;
  return (
    <>
      <PageHeader title="Avisos" description="Alertas internos de estoque e de inventário. Avisos de estoque são gerados pela rotina (botão em Reposição) e ao abrir o painel; cada aviso aparece uma vez por dia e produto. Os avisos de gestão vão para administradores e gestores." />
      {unread > 0 ? <div className="mb-4"><MarkReadForm /></div> : null}
      {list.length === 0 ? <EmptyState title="Nenhum aviso" description="Quando algo pedir sua atenção (estoque baixo, inventário aguardando aprovação), aparecerá aqui." /> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {list.map((n) => (
            <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{n.read_at ? null : <Badge tone="danger">Novo</Badge>}{n.title}</p>
                <p className="text-sm text-muted">{n.body}</p>
                <p className="mt-1 text-xs text-muted"><DateTimeBR value={n.created_at} tz={p.tz} />{n.link ? <> · <Link className="underline" href={n.link}>Abrir</Link></> : null}</p>
              </div>
              {n.read_at ? null : <MarkReadForm id={n.id} />}
            </li>
          ))}
        </ul>
      )}
      <Section title="Preferências">
        <Disclosure summary="Escolher quais avisos receber">
          <div className="space-y-3">{NOTIFICATION_TYPES.map((t) => <PrefForm key={t} type={t} label={NOTIFICATION_LABELS[t]} enabled={prefs.get(t) ?? true} />)}</div>
        </Disclosure>
      </Section>
    </>
  );
}
