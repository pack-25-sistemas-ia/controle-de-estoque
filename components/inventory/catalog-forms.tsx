'use client';

import { useId, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import {
  createCategory, createLocation, createProduct, createSupplier, createUnit, createWarehouse, deleteRule, grantAccess, linkSupplier, revokeAccess, saveRule, setProductArchived,
  unlinkSupplier, updateCategory, updateProduct, updateSettings, updateSupplier, updateUnit, updateWarehouse,
} from '@/lib/inventory/actions/catalog';
import { internalCode } from '@/lib/inventory/barcode';
import type { ProductRow, SupplierRow, WarehouseRow, UnitRow, InvSettings } from '@/lib/inventory/data';
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from '@/lib/inventory/labels';
import type { Opt } from './bits';
import { useInvAction } from './use-inv-action';

const OptionList = ({ opts, placeholder }: { opts: Opt[]; placeholder?: string }) => (
  <>{placeholder !== undefined ? <option value="">{placeholder}</option> : null}{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</>
);
const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

/** Cadastro e edição de produto. `canParams` = gestor/administrador (operador não define reposição nem fornecedor principal; o banco também recusa). */
export function ProductForm({ product, categories, units, suppliers, canParams, canArchive }: { product?: ProductRow; categories: Opt[]; units: Opt[]; suppliers: Opt[]; canParams: boolean; canArchive?: boolean }) {
  const p = useId();
  const editing = Boolean(product);
  const [state, action, ref] = useInvAction(editing ? updateProduct : createProduct, { reset: !editing });
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  void canArchive;
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <Field label="SKU" name={`${p}sku`} errors={e.sku} hint="Único por empresa."><Input id={`${p}sku`} name="sku" required maxLength={40} defaultValue={v.sku ?? product?.sku} /></Field>
      <div className="sm:col-span-2"><Field label="Nome" name={`${p}name`} errors={e.name}><Input id={`${p}name`} name="name" required maxLength={160} defaultValue={v.name ?? product?.name} /></Field></div>
      <Field label="Tipo" name={`${p}pt`} errors={e.product_type}><Select id={`${p}pt`} name="product_type" defaultValue={v.product_type ?? product?.product_type ?? 'merchandise'}>{PRODUCT_TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABELS[t]}</option>)}</Select></Field>
      <Field label="Unidade de medida" name={`${p}unit`} errors={e.unit_id} hint={editing ? 'Não muda depois da primeira movimentação.' : 'Define as casas decimais aceitas.'}><Select id={`${p}unit`} name="unit_id" required defaultValue={v.unit_id ?? product?.unit_id ?? ''}><OptionList opts={units} placeholder="Selecione…" /></Select></Field>
      <Field label="Preço informativo (opcional)" name={`${p}pr`} errors={e.price} hint="Só para etiquetas; não entra em custo nem em valor de estoque."><Input id={`${p}pr`} name="price" inputMode="decimal" defaultValue={v.price ?? (product?.list_price_cents != null ? (product.list_price_cents / 100).toFixed(2).replace('.', ',') : '')} /></Field>
      <Field label="Categoria" name={`${p}cat`} errors={e.category_id}><Select id={`${p}cat`} name="category_id" defaultValue={v.category_id ?? product?.category_id ?? ''}><OptionList opts={categories} placeholder="— sem categoria —" /></Select></Field>
      <div className="sm:col-span-2">
        <Field label="Código de barras (opcional)" name={`${p}bc`} errors={e.barcode} hint="EAN-8, UPC-A ou EAN-13 com dígito verificador, ou código interno (ex.: INT-0001).">
          <div className="flex gap-2">
            <Input id={`${p}bc`} name="barcode" maxLength={48} value={barcode} onChange={(ev) => setBarcode(ev.target.value)} />
            <button type="button" className="min-h-10 shrink-0 rounded-md border border-border px-3 text-sm hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setBarcode(internalCode())}>Gerar interno</button>
          </div>
        </Field>
      </div>
      {editing ? <Field label="Situação" name={`${p}st`} errors={e.status}><Select id={`${p}st`} name="status" defaultValue={v.status ?? product?.status ?? 'active'} disabled={!canParams}><option value="active">Ativo</option><option value="inactive">Inativo (não recebe movimentação)</option></Select>{!canParams ? <input type="hidden" name="status" value={product?.status} /> : null}</Field> : null}
      <div className="sm:col-span-4"><Field label="Descrição (opcional)" name={`${p}desc`} errors={e.description}><Textarea id={`${p}desc`} name="description" maxLength={1000} defaultValue={v.description ?? product?.description ?? ''} className="min-h-16" /></Field></div>
      {canParams ? (
        <fieldset className="grid gap-4 sm:col-span-4 sm:grid-cols-4 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Reposição (opcional)</legend>
          <Field label="Estoque mínimo" name={`${p}mn`} errors={e.minimum_stock}><Input id={`${p}mn`} name="minimum_stock" inputMode="decimal" defaultValue={v.minimum_stock ?? num(product?.minimum_stock)} /></Field>
          <Field label="Ponto de reposição" name={`${p}rp`} errors={e.reorder_point}><Input id={`${p}rp`} name="reorder_point" inputMode="decimal" defaultValue={v.reorder_point ?? num(product?.reorder_point)} /></Field>
          <Field label="Estoque-alvo" name={`${p}tg`} errors={e.target_stock}><Input id={`${p}tg`} name="target_stock" inputMode="decimal" defaultValue={v.target_stock ?? num(product?.target_stock)} /></Field>
          <Field label="Fornecedor principal" name={`${p}sp`} errors={e.default_supplier_id}><Select id={`${p}sp`} name="default_supplier_id" defaultValue={v.default_supplier_id ?? product?.default_supplier_id ?? ''}><OptionList opts={suppliers} placeholder="— nenhum —" /></Select></Field>
        </fieldset>
      ) : null}
      <div className="space-y-3 sm:col-span-4"><FormMessage state={state} /><SubmitButton pendingText="Salvando…">{editing ? 'Salvar produto' : 'Cadastrar produto'}</SubmitButton></div>
    </form>
  );
}

export function ArchiveProductForm({ id, archived }: { id: string; archived: boolean }) {
  const [state, action] = useInvAction(setProductArchived, { reset: false });
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="archive" value={archived ? '0' : '1'} />
      <p className="text-sm text-muted">{archived ? 'Reativa o produto para novas movimentações.' : 'Arquivar esconde o produto das listas e impede novas movimentações; o histórico permanece. Só é possível com saldo zero.'}</p>
      <SubmitButton variant={archived ? 'secondary' : 'danger'} pendingText="…">{archived ? 'Reativar produto' : 'Arquivar produto'}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CategoryForm({ parents }: { parents: Opt[] }) {
  const p = useId();
  const [state, action, ref] = useInvAction(createCategory);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      <Field label="Nome" name={`${p}n`} errors={e.name}><Input id={`${p}n`} name="name" required maxLength={80} defaultValue={state.values?.name} /></Field>
      <div className="sm:col-span-2"><Field label="Categoria-pai (opcional)" name={`${p}pa`} errors={e.parent_id} hint="Até 4 níveis."><Select id={`${p}pa`} name="parent_id" defaultValue={state.values?.parent_id ?? ''}><OptionList opts={parents} placeholder="— categoria principal —" /></Select></Field></div>
      <Field label="Descrição (opcional)" name={`${p}d`} errors={e.description}><Input id={`${p}d`} name="description" maxLength={300} defaultValue={state.values?.description} /></Field>
      <div className="space-y-3 sm:col-span-4"><FormMessage state={state} /><SubmitButton pendingText="Criando…">Criar categoria</SubmitButton></div>
    </form>
  );
}

export function CategoryRowForm({ id, name, description, active }: { id: string; name: string; description: string | null; active: boolean }) {
  const [state, action] = useInvAction(updateCategory, { reset: false });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`cn-${id}`} className="sr-only">Nome</label>
      <Input id={`cn-${id}`} name="name" defaultValue={name} required maxLength={80} className="w-56" />
      <label htmlFor={`cd-${id}`} className="sr-only">Descrição</label>
      <Input id={`cd-${id}`} name="description" defaultValue={description ?? ''} maxLength={300} placeholder="Descrição" className="w-64" />
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={active} /> Ativa</label>
      <SubmitButton variant="secondary" pendingText="…">Salvar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function SupplierForm({ supplier }: { supplier?: SupplierRow }) {
  const p = useId();
  const editing = Boolean(supplier);
  const [state, action, ref] = useInvAction(editing ? updateSupplier : createSupplier, { reset: !editing });
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      {supplier ? <input type="hidden" name="id" value={supplier.id} /> : null}
      <div className="sm:col-span-2"><Field label="Nome" name={`${p}n`} errors={e.name}><Input id={`${p}n`} name="name" required maxLength={120} defaultValue={v.name ?? supplier?.name} /></Field></div>
      <div className="sm:col-span-2"><Field label="Razão social" name={`${p}l`} errors={e.legal_name}><Input id={`${p}l`} name="legal_name" maxLength={160} defaultValue={v.legal_name ?? supplier?.legal_name ?? ''} /></Field></div>
      <Field label="CPF/CNPJ (opcional)" name={`${p}dc`} errors={e.document_number}><Input id={`${p}dc`} name="document_number" maxLength={20} inputMode="numeric" defaultValue={v.document_number ?? supplier?.document_number ?? ''} /></Field>
      <Field label="E-mail" name={`${p}em`} errors={e.email}><Input id={`${p}em`} name="email" type="email" maxLength={160} defaultValue={v.email ?? supplier?.email ?? ''} /></Field>
      <Field label="Telefone" name={`${p}ph`} errors={e.phone}><Input id={`${p}ph`} name="phone" maxLength={30} defaultValue={v.phone ?? supplier?.phone ?? ''} /></Field>
      <Field label="Prazo de entrega (dias)" name={`${p}lt`} errors={e.lead_time_days}><Input id={`${p}lt`} name="lead_time_days" type="number" min={0} max={365} defaultValue={v.lead_time_days ?? supplier?.lead_time_days ?? ''} /></Field>
      <div className="sm:col-span-3"><Field label="Observações" name={`${p}no`} errors={e.notes}><Input id={`${p}no`} name="notes" maxLength={500} defaultValue={v.notes ?? supplier?.notes ?? ''} /></Field></div>
      {editing ? <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={supplier?.active} /> Ativo</label> : null}
      <div className="space-y-3 sm:col-span-4"><FormMessage state={state} /><SubmitButton pendingText="Salvando…">{editing ? 'Salvar fornecedor' : 'Cadastrar fornecedor'}</SubmitButton></div>
    </form>
  );
}

export function WarehouseForm({ warehouse }: { warehouse?: WarehouseRow }) {
  const p = useId();
  const editing = Boolean(warehouse);
  const [state, action, ref] = useInvAction(editing ? updateWarehouse : createWarehouse, { reset: !editing });
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      {warehouse ? <input type="hidden" name="id" value={warehouse.id} /> : null}
      <Field label="Nome" name={`${p}n`} errors={e.name}><Input id={`${p}n`} name="name" required maxLength={80} defaultValue={v.name ?? warehouse?.name} /></Field>
      <Field label="Código" name={`${p}c`} errors={e.code} hint="Ex.: LOJA, CD."><Input id={`${p}c`} name="code" required maxLength={20} defaultValue={v.code ?? warehouse?.code} /></Field>
      <div className="sm:col-span-2"><Field label="Endereço (opcional)" name={`${p}a`} errors={e.address}><Input id={`${p}a`} name="address" maxLength={300} defaultValue={v.address ?? warehouse?.address ?? ''} /></Field></div>
      <div className="sm:col-span-3"><Field label="Descrição (opcional)" name={`${p}d`} errors={e.description}><Input id={`${p}d`} name="description" maxLength={300} defaultValue={v.description ?? warehouse?.description ?? ''} /></Field></div>
      {editing ? <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={warehouse?.active} /> Ativo (desmarcar arquiva; exige saldo zero)</label> : null}
      <div className="space-y-3 sm:col-span-4"><FormMessage state={state} /><SubmitButton pendingText="Salvando…">{editing ? 'Salvar depósito' : 'Criar depósito'}</SubmitButton></div>
    </form>
  );
}

export function LocationForm({ warehouseId, parents }: { warehouseId: string; parents: Opt[] }) {
  const p = useId();
  const [state, action, ref] = useInvAction(createLocation);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      <input type="hidden" name="warehouse_id" value={warehouseId} />
      <Field label="Código" name={`${p}c`} errors={e.code} hint="Ex.: A1, PRAT-03."><Input id={`${p}c`} name="code" required maxLength={20} defaultValue={state.values?.code} /></Field>
      <Field label="Nome" name={`${p}n`} errors={e.name}><Input id={`${p}n`} name="name" required maxLength={80} defaultValue={state.values?.name} /></Field>
      <Field label="Dentro de (opcional)" name={`${p}pa`} errors={e.parent_id}><Select id={`${p}pa`} name="parent_id" defaultValue={state.values?.parent_id ?? ''}><OptionList opts={parents} placeholder="— nível principal —" /></Select></Field>
      <div className="space-y-3 self-end"><SubmitButton pendingText="…">Adicionar localização</SubmitButton></div>
      <div className="sm:col-span-4"><FormMessage state={state} /></div>
    </form>
  );
}

export function AccessForm({ operators, warehouses }: { operators: Opt[]; warehouses: Opt[] }) {
  const p = useId();
  const [state, action, ref] = useInvAction(grantAccess);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <Field label="Operador" name={`${p}u`} errors={e.user_id}><Select id={`${p}u`} name="user_id" required className="w-56"><OptionList opts={operators} placeholder="Selecione…" /></Select></Field>
      <Field label="Depósito autorizado" name={`${p}w`} errors={e.warehouse_id}><Select id={`${p}w`} name="warehouse_id" required className="w-56"><OptionList opts={warehouses} placeholder="Selecione…" /></Select></Field>
      <SubmitButton pendingText="…">Autorizar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function RevokeAccessForm({ userId, warehouseId, label }: { userId: string; warehouseId: string; label: string }) {
  const [state, action] = useInvAction(revokeAccess, { reset: false });
  return (
    <form action={action} className="inline-flex items-center gap-2"><input type="hidden" name="user_id" value={userId} /><input type="hidden" name="warehouse_id" value={warehouseId} />
      <SubmitButton variant="ghost" pendingText="…">{`Remover ${label}`}</SubmitButton><FormMessage state={state} /></form>
  );
}

export function UnitForm() {
  const p = useId();
  const [state, action, ref] = useInvAction(createUnit);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      <Field label="Símbolo" name={`${p}s`} errors={e.symbol} hint="Ex.: m², pç."><Input id={`${p}s`} name="symbol" required maxLength={8} defaultValue={state.values?.symbol} /></Field>
      <Field label="Nome" name={`${p}n`} errors={e.name}><Input id={`${p}n`} name="name" required maxLength={40} defaultValue={state.values?.name} /></Field>
      <Field label="Casas decimais" name={`${p}d`} errors={e.decimal_places} hint="0 = só inteiros; até 3. Não muda depois."><Select id={`${p}d`} name="decimal_places" defaultValue={state.values?.decimal_places ?? '0'}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
      <div className="space-y-3 self-end"><SubmitButton pendingText="…">Criar unidade</SubmitButton></div>
      <div className="sm:col-span-4"><FormMessage state={state} /></div>
    </form>
  );
}

export function UnitRowForm({ unit }: { unit: UnitRow }) {
  const [state, action] = useInvAction(updateUnit, { reset: false });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="id" value={unit.id} />
      <label htmlFor={`us-${unit.id}`} className="sr-only">Símbolo</label><Input id={`us-${unit.id}`} name="symbol" defaultValue={unit.symbol} maxLength={8} required className="w-20" />
      <label htmlFor={`un-${unit.id}`} className="sr-only">Nome</label><Input id={`un-${unit.id}`} name="name" defaultValue={unit.name} maxLength={40} required className="w-48" />
      <span className="text-xs text-muted">{unit.decimal_places} casa(s)</span>
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={unit.active} /> Ativa</label>
      <SubmitButton variant="secondary" pendingText="…">Salvar</SubmitButton><FormMessage state={state} />
    </form>
  );
}

export function SettingsForm({ settings }: { settings: InvSettings }) {
  const p = useId();
  const [state, action] = useInvAction(updateSettings, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      <Field label="Produto parado após (dias)" name={`${p}i`} errors={e.idle_days} hint="Sem saída operacional neste período."><Input id={`${p}i`} name="idle_days" type="number" min={7} max={730} defaultValue={state.values?.idle_days ?? settings.idle_days} /></Field>
      <Field label="Janela de cobertura (dias)" name={`${p}c`} errors={e.coverage_window_days} hint="Consumo médio usado na cobertura."><Input id={`${p}c`} name="coverage_window_days" type="number" min={7} max={365} defaultValue={state.values?.coverage_window_days ?? settings.coverage_window_days} /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="label_company_name" defaultChecked={settings.label_company_name} /> Nome da empresa na etiqueta</label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="label_show_price" defaultChecked={settings.label_show_price} /> Permitir preço informativo na etiqueta</label>
      <div className="space-y-3 sm:col-span-4"><FormMessage state={state} /><SubmitButton pendingText="Salvando…">Salvar configurações</SubmitButton></div>
    </form>
  );
}

export function RuleForm({ productId, warehouses }: { productId: string; warehouses: Opt[] }) {
  const p = useId();
  const [state, action, ref] = useInvAction(saveRule);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-5" noValidate>
      <input type="hidden" name="product_id" value={productId} />
      <Field label="Depósito" name={`${p}w`} errors={e.warehouse_id} hint="Vazio = padrão do produto."><Select id={`${p}w`} name="warehouse_id" defaultValue={state.values?.warehouse_id ?? ''}><OptionList opts={warehouses} placeholder="— todos (padrão) —" /></Select></Field>
      <Field label="Mínimo" name={`${p}mn`} errors={e.minimum_quantity}><Input id={`${p}mn`} name="minimum_quantity" inputMode="decimal" required defaultValue={state.values?.minimum_quantity} /></Field>
      <Field label="Ponto de reposição" name={`${p}rp`} errors={e.reorder_point}><Input id={`${p}rp`} name="reorder_point" inputMode="decimal" required defaultValue={state.values?.reorder_point} /></Field>
      <Field label="Estoque-alvo" name={`${p}tg`} errors={e.target_quantity}><Input id={`${p}tg`} name="target_quantity" inputMode="decimal" defaultValue={state.values?.target_quantity} /></Field>
      <Field label="Prazo (dias)" name={`${p}lt`} errors={e.lead_time_days}><Input id={`${p}lt`} name="lead_time_days" type="number" min={0} max={365} defaultValue={state.values?.lead_time_days} /></Field>
      <div className="space-y-3 sm:col-span-5"><FormMessage state={state} /><SubmitButton pendingText="Salvando…">Salvar regra</SubmitButton></div>
    </form>
  );
}

export function DeleteRuleForm({ id }: { id: string }) {
  const [state, action] = useInvAction(deleteRule, { reset: false });
  return <form action={action} className="inline-flex items-center gap-2"><input type="hidden" name="id" value={id} /><SubmitButton variant="ghost" pendingText="…">Remover regra</SubmitButton><FormMessage state={state} /></form>;
}

export function LinkSupplierForm({ productId, suppliers }: { productId: string; suppliers: Opt[] }) {
  const p = useId();
  const [state, action, ref] = useInvAction(linkSupplier);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      <input type="hidden" name="product_id" value={productId} />
      <Field label="Fornecedor" name={`${p}s`} errors={e.supplier_id}><Select id={`${p}s`} name="supplier_id" required><OptionList opts={suppliers} placeholder="Selecione…" /></Select></Field>
      <Field label="SKU no fornecedor" name={`${p}k`} errors={e.supplier_sku}><Input id={`${p}k`} name="supplier_sku" maxLength={60} defaultValue={state.values?.supplier_sku} /></Field>
      <Field label="Prazo (dias)" name={`${p}l`} errors={e.lead_time_days}><Input id={`${p}l`} name="lead_time_days" type="number" min={0} max={365} defaultValue={state.values?.lead_time_days} /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="is_preferred" /> Fornecedor preferencial</label>
      <div className="space-y-3 sm:col-span-4"><FormMessage state={state} /><SubmitButton pendingText="…">Associar fornecedor</SubmitButton></div>
    </form>
  );
}

export function UnlinkSupplierForm({ id, productId }: { id: string; productId: string }) {
  const [state, action] = useInvAction(unlinkSupplier, { reset: false });
  return <form action={action} className="inline-flex items-center gap-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="product_id" value={productId} /><SubmitButton variant="ghost" pendingText="…">Remover</SubmitButton><FormMessage state={state} /></form>;
}
