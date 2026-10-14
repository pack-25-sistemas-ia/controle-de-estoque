# DATABASE — Controle de Estoque Inteligente

Postgres (Supabase) com RLS em todas as tabelas. As regras de estoque e custo vivem em **funções SQL** `SECURITY DEFINER` (`set search_path = ''`), todas iniciando por `private.inv_guard(org, nível[, depósito])` (sessão válida + MFA + papel + depósito autorizado). Tabelas de negócio não aceitam escrita direta do usuário: só pelas funções.

## Migrações (ordem)
| Arquivo | Conteúdo |
|---|---|
| `…0000_inv_schema.sql` | Tabelas, índices, constraints, RLS, sequência `inv_op_seq` |
| `…0100_inv_guards.sql` | `inv_guard`, helpers de papel/depósito, gatilhos de imutabilidade, unidades padrão |
| `…0200_inv_engine.sql` | Motor: entrada, saída, transferência, ajuste, saldo inicial, estorno, reconciliação, travas e idempotência |
| `…0300_inv_counts_replenishment.sql` | Inventário físico, reposição, avisos, `inv_run_routines` |
| `…0400_inv_metrics.sql` | Visões e funções de indicadores, séries, giro, parados |
| `…0500_inv_attachments_export.sql` | Anexos, bucket privado `inv-files`, auditoria de exportação |
| `…0600_inv_import.sql` | Importação CSV (prévia validada no banco, confirmação atômica) |

## Tabelas principais
- **Cadastro**: `products`, `product_categories`, `units_of_measure`, `suppliers`, `product_suppliers`, `warehouses`, `warehouse_locations`, `warehouse_access`, `reorder_rules`, `inv_settings`.
- **Livro e saldos**: `stock_operations` (cabeçalho: tipo, status, número, chave de idempotência, hash do pedido, referência de estorno) → `stock_operation_items` → `stock_movements` (**imutável**: quantidade com sinal, valor em centavos, saldo após) → `inventory_balances` (check ≥ 0; `quantity_reserved` = 0) e `inventory_cost_state` (quantidade e valor acumulado por produto; a média é derivada) + `inventory_cost_events` (trilha do custo).
- **Inventário**: `physical_counts`, `physical_count_items` (esperado e versão do saldo no snapshot).
- **Reposição e avisos**: `replenishment_suggestions`, `inv_notifications`, `inv_notification_prefs`.
- **Apoio**: `attachments`, `import_jobs`, `import_rows`, `audit_log`, `privacy_requests`; do Core: `organizations`, `organization_members`, `organization_settings`, `profiles`.

## Visões
`inv_stock_view` (saldo e valor por produto × depósito, valor distribuído por maior resto) e `inv_operations_view` (operações com número **por empresa**, calculado por `row_number`, sem contador compartilhado).

## Garantias no banco
| Garantia | Mecanismo |
|---|---|
| Sem estoque negativo | `check (quantity_on_hand >= 0)` + verificação sob trava na função |
| Livro imutável | gatilhos recusam UPDATE/DELETE em movimentos e itens; operação só muda confirmada → estornada |
| Conservação | saldo = Σ movimentos; valor = Σ valor dos movimentos; `inv_reconcile` confere |
| Sem inteiro↔decimal misturado | quantidade `numeric(18,3)` com escala por unidade; dinheiro `bigint` em centavos; custo unitário até 4 casas de centavo |
| Idempotência | `unique (organization_id, idempotency_key)` + `request_hash` + advisory lock; mesma chave com conteúdo diferente é recusada |
| Concorrência sem impasse | ordem única de travas: saldos (depósito, produto) em ordem → estado de custo por produto; contador de operações é **sequência global** (sem linha quente) |
| Isolamento | `organization_id` em tudo, RLS por membro, chaves compostas `(id, organization_id)`, `search_path` fixo, `EXECUTE` revogado de `anon`/`public` |
| Embed do Core sem ambiguidade | `inv_notifications` referencia só `organization_members` (PGRST201, teste do Core) |

## Testes do banco
`pnpm test:db` sobe Postgres 17 em Docker, aplica as migrações em banco limpo e roda: Core (10 isolamento, 20 perfis, 30 MFA, 40 membros) e `70` motor, `71` inventário/reposição, `72` métricas (datas fixas, totais à mão em METRICS.md), `73` importação/anexos. `pnpm test:concurrency` abre sessões reais simultâneas (largada sincronizada). `pnpm test:mutation` quebra regras de propósito e exige que algum teste reprove.

## Backup e restauração
Veja DEPLOYMENT.md. Depois de restaurar: `select public.inv_reconcile('<org>')` não deve devolver nenhuma linha (cada linha é uma divergência).
