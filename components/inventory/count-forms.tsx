'use client';

import { useId } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import {
  addCountProduct, approveCount, cancelCount, createCount, markNotificationsRead, recordCount, reopenCount, reviewSuggestion, runRoutines, setNotificationPref, setSurplusCost, submitCount,
} from '@/lib/inventory/actions/counts';
import type { Opt } from './bits';
import { useInvAction } from './use-inv-action';

export function CreateCountForm({ warehouses }: { warehouses: Opt[] }) {
  const p = useId();
  const [state, action, ref] = useInvAction(createCount);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      <Field label="Depósito" name={`${p}w`} errors={e.warehouse_id}><Select id={`${p}w`} name="warehouse_id" required defaultValue={state.values?.warehouse_id ?? ''}><option value="" disabled>Selecione…</option>{warehouses.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</Select></Field>
      <div className="sm:col-span-2"><Field label="Título" name={`${p}t`} errors={e.title} hint="Ex.: Contagem geral de outubro."><Input id={`${p}t`} name="title" required maxLength={120} defaultValue={state.values?.title} /></Field></div>
      <div className="sm:col-span-4"><Field label="SKUs a contar (opcional)" name={`${p}s`} errors={e.skus} hint="Separe por espaço, vírgula ou linha. Vazio = todos os produtos com saldo neste depósito."><Textarea id={`${p}s`} name="skus" maxLength={10000} defaultValue={state.values?.skus} className="min-h-16" /></Field></div>
      <div className="sm:col-span-4"><Field label="Observações (opcional)" name={`${p}n`} errors={e.notes}><Input id={`${p}n`} name="notes" maxLength={500} defaultValue={state.values?.notes} /></Field></div>
      <div className="space-y-3 sm:col-span-4"><FormMessage state={state} /><SubmitButton pendingText="Iniciando…">Iniciar inventário</SubmitButton></div>
    </form>
  );
}

/** Uma linha por produto: o operador digita a quantidade contada (a esperada fica oculta até enviar? não: mostrada, para conferência). */
export function CountRow({ itemId, counted, unit, disabled }: { itemId: string; counted: number | null; unit: string; disabled: boolean }) {
  const [state, action] = useInvAction(recordCount, { reset: false });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="item_id" value={itemId} />
      <label htmlFor={`cc-${itemId}`} className="sr-only">Quantidade contada</label>
      <Input id={`cc-${itemId}`} name="counted" inputMode="decimal" defaultValue={counted === null ? '' : String(counted).replace('.', ',')} className="w-28 text-right" disabled={disabled} required />
      <span className="text-xs text-muted">{unit}</span>
      <SubmitButton variant="secondary" pendingText="…">Registrar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function IdForm({ id, action: act, label, variant = 'primary', pending, done }: { id: string; action: 'submit' | 'approve' | 'reopen'; label: string; variant?: 'primary' | 'secondary' | 'danger'; pending: string; done?: string }) {
  const fn = act === 'submit' ? submitCount : act === 'approve' ? approveCount : reopenCount;
  const [state, action] = useInvAction(fn, { reset: false });
  void done;
  return <form action={action} className="space-y-2"><input type="hidden" name="id" value={id} /><SubmitButton variant={variant} pendingText={pending}>{label}</SubmitButton><FormMessage state={state} /></form>;
}

export function CancelCountForm({ id }: { id: string }) {
  const p = useId();
  const [state, action] = useInvAction(cancelCount, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <Field label="Motivo do cancelamento" name={`${p}r`} errors={e.reason}><Input id={`${p}r`} name="reason" required maxLength={300} defaultValue={state.values?.reason} /></Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" pendingText="…">Cancelar inventário</SubmitButton>
    </form>
  );
}

export function SurplusCostForm({ itemId, value }: { itemId: string; value: number | null }) {
  const [state, action] = useInvAction(setSurplusCost, { reset: false });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="item_id" value={itemId} />
      <label htmlFor={`sc-${itemId}`} className="sr-only">Custo unitário da sobra em reais</label>
      <Input id={`sc-${itemId}`} name="cost" inputMode="decimal" placeholder="R$ por unidade" defaultValue={value === null ? '' : (value / 100).toFixed(2).replace('.', ',')} className="w-32" />
      <SubmitButton variant="secondary" pendingText="…">Salvar custo</SubmitButton><FormMessage state={state} />
    </form>
  );
}

export function AddCountProductForm({ id }: { id: string }) {
  const p = useId();
  const [state, action, ref] = useInvAction(addCountProduct);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <Field label="Incluir produto (ID)" name={`${p}pid`} hint="Use a página do produto para copiar o identificador.">
        <Input id={`${p}pid`} name="product_id" className="w-80" required />
      </Field>
      <SubmitButton variant="secondary" pendingText="…">Incluir</SubmitButton><FormMessage state={state} />
    </form>
  );
}

export function RunRoutinesForm() {
  const [state, action] = useInvAction(runRoutines, { reset: false });
  return <form action={action} className="space-y-2"><SubmitButton variant="secondary" pendingText="Calculando…">Atualizar sugestões e avisos agora</SubmitButton><FormMessage state={state} /></form>;
}

export function ReviewSuggestionForm({ id, suggested }: { id: string; suggested: number | null }) {
  const [state, action] = useInvAction(reviewSuggestion, { reset: false });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`rq-${id}`} className="sr-only">Quantidade sugerida (ajustável)</label>
      <Input id={`rq-${id}`} name="quantity" inputMode="decimal" defaultValue={suggested === null ? '' : String(suggested).replace('.', ',')} className="w-28 text-right" />
      <button type="submit" name="status" value="reviewed" className="min-h-10 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Marcar como analisada</button>
      <button type="submit" name="status" value="dismissed" className="min-h-10 rounded-md border border-border px-3 text-sm">Descartar</button>
      <FormMessage state={state} />
    </form>
  );
}

export function MarkReadForm({ id }: { id?: string }) {
  const [state, action] = useInvAction(markNotificationsRead, { reset: false });
  return <form action={action} className="inline-flex items-center gap-2">{id ? <input type="hidden" name="id" value={id} /> : null}<SubmitButton variant="secondary" pendingText="…">{id ? 'Marcar como lido' : 'Marcar todos como lidos'}</SubmitButton><FormMessage state={state} /></form>;
}

export function PrefForm({ type, label, enabled }: { type: string; label: string; enabled: boolean }) {
  const [state, action] = useInvAction(setNotificationPref, { reset: false });
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="type" value={type} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={enabled} /> {label}</label>
      <SubmitButton variant="secondary" pendingText="…">Salvar</SubmitButton><FormMessage state={state} />
    </form>
  );
}
