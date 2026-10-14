// Rótulos em português e permissões de tela. A interface só ESCONDE; quem autoriza de verdade é o banco (docs/PERMISSIONS.md).
import type { OrgRole } from '@/lib/validation/org';

export function can(role: OrgRole) {
  const admin = role === 'owner' || role === 'admin';
  const manager = admin || role === 'manager';
  const operator = manager || role === 'member';
  return { read: true, operator, manager, admin };
}
export type Perms = ReturnType<typeof can>;

export const ROLE_LABELS: Record<OrgRole, string> = { owner: 'Administrador (proprietário)', admin: 'Administrador', manager: 'Gestor de estoque', member: 'Operador', viewer: 'Consulta' };

export const PRODUCT_TYPES = ['merchandise', 'raw_material', 'supply', 'consumable', 'other'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = { merchandise: 'Mercadoria', raw_material: 'Matéria-prima', supply: 'Insumo', consumable: 'Material de consumo', other: 'Outro' };

export const ENTRY_REASONS = ['purchase', 'customer_return', 'other_entry'] as const;
export const ENTRY_REASON_LABELS: Record<(typeof ENTRY_REASONS)[number], string> = { purchase: 'Compra', customer_return: 'Devolução de cliente', other_entry: 'Outra entrada' };
export const ISSUE_REASONS = ['sale', 'internal_use', 'loss', 'damage', 'supplier_return', 'sample', 'other_issue'] as const;
export const ISSUE_REASON_LABELS: Record<(typeof ISSUE_REASONS)[number], string> = {
  sale: 'Venda', internal_use: 'Consumo interno', loss: 'Perda', damage: 'Avaria', supplier_return: 'Devolução ao fornecedor', sample: 'Amostra', other_issue: 'Outro motivo',
};
export const ADJUST_REASONS = ['count_difference', 'damage', 'loss', 'operational_error', 'other_adjustment'] as const;
export const ADJUST_REASON_LABELS: Record<(typeof ADJUST_REASONS)[number], string> = {
  count_difference: 'Divergência de inventário', damage: 'Avaria', loss: 'Perda', operational_error: 'Erro operacional', other_adjustment: 'Outro motivo justificado',
};
export const REASON_LABELS: Record<string, string> = { ...ENTRY_REASON_LABELS, ...ISSUE_REASON_LABELS, ...ADJUST_REASON_LABELS, opening: 'Saldo inicial' };

export const OP_TYPES = ['entry', 'issue', 'transfer', 'adjustment', 'opening', 'count_adjustment', 'reversal'] as const;
export type OpType = (typeof OP_TYPES)[number];
export const OP_TYPE_LABELS: Record<OpType, string> = {
  entry: 'Entrada', issue: 'Saída', transfer: 'Transferência', adjustment: 'Ajuste', opening: 'Saldo inicial', count_adjustment: 'Ajuste de inventário', reversal: 'Estorno',
};
export const MOVE_TYPE_LABELS: Record<string, string> = {
  entry: 'Entrada', issue: 'Saída', transfer_out: 'Transferência (saída)', transfer_in: 'Transferência (entrada)', adjustment_in: 'Ajuste positivo', adjustment_out: 'Ajuste negativo',
  opening: 'Saldo inicial', count_in: 'Sobra de inventário', count_out: 'Falta de inventário', reversal: 'Estorno',
};
export const COST_POLICY_LABELS: Record<string, string> = { informed: 'Custo informado', average: 'Custo médio atual', original: 'Custo da saída original', none: 'Sem custo (bonificação)' };

export type StockClass = 'normal' | 'attention' | 'critical' | 'out_of_stock';
export const STOCK_CLASS_LABELS: Record<StockClass, string> = { normal: 'Normal', attention: 'Atenção', critical: 'Crítico', out_of_stock: 'Sem estoque' };
export const STOCK_CLASS_TONES: Record<StockClass, 'success' | 'warning' | 'danger' | 'neutral'> = { normal: 'success', attention: 'warning', critical: 'danger', out_of_stock: 'danger' };

export const COUNT_STATUS_LABELS: Record<string, string> = { draft: 'Rascunho', counting: 'Em contagem', awaiting_approval: 'Aguardando aprovação', completed: 'Concluído', cancelled: 'Cancelado' };
export const COUNT_STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { counting: 'warning', awaiting_approval: 'warning', completed: 'success', cancelled: 'neutral', draft: 'neutral' };
export const SUGGESTION_STATUS_LABELS: Record<string, string> = { pending: 'Pendente', reviewed: 'Analisada', dismissed: 'Descartada' };

export const NOTIFICATION_TYPES = ['below_minimum', 'out_of_stock', 'idle_product', 'count_done', 'count_divergence', 'replenishment', 'import_failed', 'operation_reversed', 'count_waiting'] as const;
export const NOTIFICATION_LABELS: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  below_minimum: 'Estoque abaixo do mínimo', out_of_stock: 'Produto sem estoque', idle_product: 'Produto parado', count_done: 'Inventário concluído', count_divergence: 'Inventário com divergências',
  replenishment: 'Reposição sugerida', import_failed: 'Falha na importação', operation_reversed: 'Operação estornada', count_waiting: 'Inventário aguardando aprovação',
};

export const IMPORT_TYPES = ['products', 'suppliers', 'categories', 'opening', 'reorder'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];
export const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  products: 'Produtos', suppliers: 'Fornecedores', categories: 'Categorias', opening: 'Saldo inicial (abertura)', reorder: 'Regras de reposição',
};
export const IMPORT_TYPE_HELP: Record<ImportType, string> = {
  products: 'Cria produtos novos. SKU que já existe é ignorado (a importação não atualiza cadastro). Unidade e categoria precisam existir.',
  suppliers: 'Cria fornecedores novos; nome repetido é ignorado.',
  categories: 'Cria categorias; a categoria-pai precisa existir ou vir antes no arquivo.',
  opening: 'Lança o saldo de abertura (movimento no livro, uma vez por produto e depósito). Exige custo unitário. Apenas gestor ou administrador.',
  reorder: 'Define mínimo, ponto de reposição e estoque-alvo por produto (ou por produto e depósito). Apenas gestor ou administrador.',
};
