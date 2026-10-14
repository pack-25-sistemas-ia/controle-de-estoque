# INVENTORY_LEDGER — Motor de estoque

O estoque **nunca** é um campo editável. Há três camadas, na mesma transação:

1. **Livro** (`stock_movements`): fonte de verdade auditável. Só-acréscimo (UPDATE/DELETE bloqueados por gatilho, inclusive para o dono do schema).
2. **Saldo materializado** (`inventory_balances`): leitura rápida por produto × depósito. Só as funções `inv_*` escrevem (sem política de escrita para `authenticated`). `check (quantity_on_hand >= 0)`.
3. **Estado de custo** (`inventory_cost_state`): quantidade e valor gerencial por produto (COSTING_RULES.md).

## Convenções
- `quantity_delta`: **positivo entra, negativo sai**, nunca zero. `numeric(18,3)`; escala máxima por unidade de medida (`units_of_measure.decimal_places`, 0 a 3).
- Dinheiro: centavos (`bigint`), teto 99.999.999.999.999. Quantidade: teto 999.999.999.999,999.
- `value_delta_cents` tem o mesmo sinal da quantidade.
- Cada movimento grava `balance_after` (saldo físico do produto naquele depósito logo após o movimento), o que permite reconstruir a evolução do saldo sem recalcular.

## Equação (por produto e depósito)
`saldo físico = Σ quantity_delta dos movimentos do par`. A abertura é um movimento `opening` (nunca um UPDATE). Teste obrigatório: `inventory_balances` = soma do livro, para todos os pares, depois de cada cenário (função `inv_reconcile(org)` devolve as divergências; esperado: zero linhas).

`disponível = saldo físico − reservado`. **Reservas não fazem parte do MVP**: `quantity_reserved` existe, tem `check (quantity_reserved = 0)` e a interface não oferece reserva; o disponível é igual ao físico.

## Operações (documento lógico) e itens
`stock_operations` agrupa 1..n itens: tipos `entry`, `issue`, `transfer`, `adjustment`, `opening`, `count_adjustment`, `reversal`. A operação nasce **confirmada**, numa única chamada (`inv_post_*`); não há rascunho de movimentação (D-E5). O estado é `confirmed` ou `reversed`; só a coluna de estado muda, por função, e uma vez.

## Fluxo de toda operação (função SECURITY DEFINER)
1. `private.inv_guard(org, nível)`: sessão, MFA, papel e, para operador com restrição, **depósito autorizado**.
2. Idempotência: `unique (organization_id, idempotency_key)` em `stock_operations`. Chave repetida com os **mesmos dados** devolve a operação original; com dados diferentes é recusada («chave já usada com outro conteúdo»).
3. Validação de produto (ativo, da organização), depósito (ativo, da organização), quantidade (≠ 0, escala da unidade), motivo, custo.
4. **Travas em ordem fixa**: primeiro as linhas de saldo ordenadas por `(warehouse_id, product_id)` (criadas com `insert … on conflict do nothing` e depois `select … for update`), em seguida os estados de custo ordenados por `product_id`. A ordem única evita impasse entre operações simultâneas e entre transferências cruzadas.
5. Regra de estoque negativo: saída só se `saldo ≥ quantidade` (política fixa: **bloquear**; não há configuração que a desligue).
6. Inserção dos movimentos, atualização do saldo (`version = version + 1`) e do custo, evento de custo, auditoria.
7. Qualquer erro desfaz tudo (função única = uma transação).

## Transferência
Uma operação, dois movimentos por item (`transfer_out` negativo na origem, `transfer_in` positivo no destino), mesmo `operation_id`, valores simétricos. Origem ≠ destino, ambos da organização e ativos. Trava ordenada dos dois saldos. Total consolidado (quantidade e valor) **não muda**; não entra em entradas/saídas operacionais.

## Estorno (correção)
Nunca edita nem apaga. `inv_reverse_operation(op, motivo)` cria uma operação `reversal` com movimentos de sinal oposto (`reverses_movement_id` aponta para o original) e marca a operação original como `reversed` (uma vez; segunda tentativa falha). Regras:
- Estorno de **entrada** só se o saldo atual cobrir a quantidade (nunca deixa negativo) e se o valor remanescente continuar coerente (COSTING_RULES.md).
- Estorno de **saída** devolve quantidade e o **valor original** da saída (não o custo médio de hoje).
- Estorno de **transferência** exige que o destino ainda tenha a quantidade.
- Operação de contagem aprovada pode ser estornada como qualquer ajuste.
- Exige perfil gestor/administrador e motivo (≥ 5 caracteres). Um estorno não pode ser estornado.

## Inventário físico
`physical_counts` guarda, por item, a quantidade esperada **e a versão do saldo** (`balance_version_at_snapshot`). Na aprovação, se `version` atual ≠ versão do snapshot, o item fica **desatualizado** e exige recontagem; ajuste só é gerado para itens atuais, como `count_adjustment`, dentro de uma transação, com idempotência por contagem+item.

## Auditoria
`audit_log` do Core registra criação/alteração de cadastros (sem valores sensíveis). O próprio livro é a trilha das movimentações: quem (`performed_by`), quando (`occurred_at`, `created_at`), por quê (`reason`), referência externa e operação.

## Propriedades verificadas por teste (SQL, concorrência e mutação)
Conservação em transferência; soma do livro = saldo; sem saldo negativo sob 20 saídas simultâneas; mesma chave duas vezes = um movimento; falha no meio da transferência não deixa meia operação; estorno duplo recusado; ledger imutável; RLS entre empresas; operador sem permissão não ajusta nem estorna.
