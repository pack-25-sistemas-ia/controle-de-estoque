'use client';

import { useId, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { postAdjustment, postEntry, postIssue, postOpening, postTransfer, reverseOperation } from '@/lib/inventory/actions/operations';
import { ADJUST_REASONS, ADJUST_REASON_LABELS, ENTRY_REASONS, ENTRY_REASON_LABELS, ISSUE_REASONS, ISSUE_REASON_LABELS } from '@/lib/inventory/labels';
import type { Opt } from './bits';
import { LineEditor } from './line-editor';
import { useInvAction } from './use-inv-action';

const OptionList = ({ opts, placeholder }: { opts: Opt[]; placeholder?: string }) => (
  <>{placeholder ? <option value="">{placeholder}</option> : null}{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</>
);

function WhSelect({ id, name, label, opts, value, onChange, errors }: { id: string; name: string; label: string; opts: Opt[]; value: string; onChange: (v: string) => void; errors?: string[] }) {
  return (
    <Field label={label} name={id} errors={errors}>
      <Select id={id} name={name} value={value} required onChange={(e) => onChange(e.target.value)}><OptionList opts={opts} placeholder="Selecione…" /></Select>
    </Field>
  );
}

export function EntryForm({ warehouses, suppliers, today, defaultWarehouse }: { warehouses: Opt[]; suppliers: Opt[]; today: string; defaultWarehouse?: string }) {
  const p = useId();
  const [state, action, ref] = useInvAction(postEntry);
  const [wh, setWh] = useState(defaultWarehouse ?? warehouses[0]?.value ?? '');
  const [reason, setReason] = useState('purchase');
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-4">
        <WhSelect id={`${p}w`} name="warehouse_id" label="Depósito de destino" opts={warehouses} value={wh} onChange={setWh} errors={e.warehouse_id} />
        <Field label="Motivo" name={`${p}reason`} errors={e.reason}><Select id={`${p}reason`} name="reason" value={reason} onChange={(ev) => setReason(ev.target.value)}>{ENTRY_REASONS.map((r) => <option key={r} value={r}>{ENTRY_REASON_LABELS[r]}</option>)}</Select></Field>
        <Field label="Fornecedor (opcional)" name={`${p}sup`} errors={e.supplier_id}><Select id={`${p}sup`} name="supplier_id" defaultValue={state.values?.supplier_id ?? ''}><OptionList opts={suppliers} placeholder="— sem fornecedor —" /></Select></Field>
        <Field label="Data" name={`${p}d`} errors={e.occurred_on} hint="Vazio = agora."><Input id={`${p}d`} name="occurred_on" type="date" max={today} defaultValue={state.values?.occurred_on ?? ''} /></Field>
        <Field label="Documento / nota (opcional)" name={`${p}ref`} errors={e.external_reference}><Input id={`${p}ref`} name="external_reference" maxLength={60} defaultValue={state.values?.external_reference} /></Field>
        <div className="sm:col-span-3"><Field label="Observações (opcional)" name={`${p}n`} errors={e.notes}><Input id={`${p}n`} name="notes" maxLength={500} defaultValue={state.values?.notes} /></Field></div>
      </div>
      <LineEditor mode="entry" warehouseId={wh} reason={reason} errors={e.items} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Registrando…">Registrar entrada</SubmitButton>
    </form>
  );
}

export function IssueForm({ warehouses, today, defaultWarehouse }: { warehouses: Opt[]; today: string; defaultWarehouse?: string }) {
  const p = useId();
  const [state, action, ref] = useInvAction(postIssue);
  const [wh, setWh] = useState(defaultWarehouse ?? warehouses[0]?.value ?? '');
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-4">
        <WhSelect id={`${p}w`} name="warehouse_id" label="Depósito de origem" opts={warehouses} value={wh} onChange={setWh} errors={e.warehouse_id} />
        <Field label="Motivo" name={`${p}reason`} errors={e.reason} hint="Venda e consumo interno contam como saída operacional."><Select id={`${p}reason`} name="reason" defaultValue={state.values?.reason ?? 'sale'}>{ISSUE_REASONS.map((r) => <option key={r} value={r}>{ISSUE_REASON_LABELS[r]}</option>)}</Select></Field>
        <Field label="Data" name={`${p}d`} errors={e.occurred_on} hint="Vazio = agora."><Input id={`${p}d`} name="occurred_on" type="date" max={today} defaultValue={state.values?.occurred_on ?? ''} /></Field>
        <Field label="Pedido / referência (opcional)" name={`${p}ref`} errors={e.external_reference}><Input id={`${p}ref`} name="external_reference" maxLength={60} defaultValue={state.values?.external_reference} /></Field>
        <div className="sm:col-span-4"><Field label="Observações" name={`${p}n`} errors={e.notes} hint="Obrigatória para perda, avaria e outro motivo (mínimo de 5 caracteres)."><Input id={`${p}n`} name="notes" maxLength={500} defaultValue={state.values?.notes} /></Field></div>
      </div>
      <LineEditor mode="issue" warehouseId={wh} errors={e.items} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Registrando…">Registrar saída</SubmitButton>
    </form>
  );
}

export function TransferForm({ warehouses, today, defaultSource }: { warehouses: Opt[]; today: string; defaultSource?: string }) {
  const p = useId();
  const [state, action, ref] = useInvAction(postTransfer);
  const [src, setSrc] = useState(defaultSource ?? warehouses[0]?.value ?? '');
  const [dst, setDst] = useState('');
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-4">
        <WhSelect id={`${p}s`} name="source_id" label="Depósito de origem" opts={warehouses} value={src} onChange={setSrc} errors={e.source_id} />
        <WhSelect id={`${p}t`} name="destination_id" label="Depósito de destino" opts={warehouses.filter((w) => w.value !== src)} value={dst} onChange={setDst} errors={e.destination_id} />
        <Field label="Data" name={`${p}d`} errors={e.occurred_on} hint="Vazio = agora."><Input id={`${p}d`} name="occurred_on" type="date" max={today} defaultValue={state.values?.occurred_on ?? ''} /></Field>
        <Field label="Observações (opcional)" name={`${p}n`} errors={e.notes}><Input id={`${p}n`} name="notes" maxLength={500} defaultValue={state.values?.notes} /></Field>
      </div>
      <p className="text-xs text-muted">A transferência retira da origem e coloca no destino na mesma operação: o total de unidades e o valor do estoque não mudam, e ela não entra em entradas nem saídas.</p>
      <LineEditor mode="transfer" warehouseId={src} errors={e.items} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Transferindo…">Registrar transferência</SubmitButton>
    </form>
  );
}

export function AdjustmentForm({ warehouses, today, defaultWarehouse }: { warehouses: Opt[]; today: string; defaultWarehouse?: string }) {
  const p = useId();
  const [state, action, ref] = useInvAction(postAdjustment);
  const [wh, setWh] = useState(defaultWarehouse ?? warehouses[0]?.value ?? '');
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [reason, setReason] = useState('count_difference');
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-4">
        <WhSelect id={`${p}w`} name="warehouse_id" label="Depósito" opts={warehouses} value={wh} onChange={setWh} errors={e.warehouse_id} />
        <Field label="Tipo de ajuste" name={`${p}dir`} errors={e.direction}><Select id={`${p}dir`} name="direction" value={dir} onChange={(ev) => setDir(ev.target.value as 'in' | 'out')}><option value="out">Negativo (retira do saldo)</option><option value="in">Positivo (acrescenta ao saldo)</option></Select></Field>
        <Field label="Motivo" name={`${p}reason`} errors={e.reason}><Select id={`${p}reason`} name="reason" value={reason} onChange={(ev) => setReason(ev.target.value)}>{ADJUST_REASONS.map((r) => <option key={r} value={r}>{ADJUST_REASON_LABELS[r]}</option>)}</Select></Field>
        <Field label="Data" name={`${p}d`} errors={e.occurred_on} hint="Vazio = agora."><Input id={`${p}d`} name="occurred_on" type="date" max={today} defaultValue={state.values?.occurred_on ?? ''} /></Field>
        <div className="sm:col-span-4"><Field label="Justificativa (obrigatória)" name={`${p}j`} errors={e.justification} hint="Fica registrada no histórico com o seu nome. Mínimo de 5 caracteres."><Textarea id={`${p}j`} name="justification" required maxLength={500} defaultValue={state.values?.justification} className="min-h-16" /></Field></div>
      </div>
      <LineEditor key={dir} mode={dir === 'in' ? 'adjust_in' : 'adjust_out'} warehouseId={wh} reason={reason} errors={e.items} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Registrando…">Registrar ajuste</SubmitButton>
    </form>
  );
}

export function OpeningForm({ warehouses, today }: { warehouses: Opt[]; today: string }) {
  const p = useId();
  const [state, action, ref] = useInvAction(postOpening);
  const [wh, setWh] = useState(warehouses[0]?.value ?? '');
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <WhSelect id={`${p}w`} name="warehouse_id" label="Depósito" opts={warehouses} value={wh} onChange={setWh} errors={e.warehouse_id} />
        <Field label="Data de abertura" name={`${p}d`} errors={e.occurred_on} hint="Vazio = agora."><Input id={`${p}d`} name="occurred_on" type="date" max={today} defaultValue={state.values?.occurred_on ?? ''} /></Field>
      </div>
      <p className="text-xs text-muted">O saldo inicial vira um movimento de abertura no histórico (nunca uma edição de saldo) e só pode ser lançado uma vez por produto e depósito. O custo unitário é obrigatório.</p>
      <LineEditor mode="opening" warehouseId={wh} errors={e.items} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Lançando…">Lançar saldo inicial</SubmitButton>
    </form>
  );
}

export function ReverseForm({ id }: { id: string }) {
  const p = useId();
  const [state, action, ref] = useInvAction(reverseOperation, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <Field label="Motivo do estorno" name={`${p}r`} errors={e.reason} hint="Nada é apagado: o estorno cria movimentos compensatórios ligados aos originais.">
        <Textarea id={`${p}r`} name="reason" required maxLength={300} defaultValue={state.values?.reason} className="min-h-16" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" pendingText="Estornando…">Estornar operação</SubmitButton>
    </form>
  );
}
