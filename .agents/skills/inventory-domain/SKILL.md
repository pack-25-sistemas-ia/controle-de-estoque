---
name: inventory-domain
description: Use ao criar ou alterar qualquer operação de estoque (entrada, saída, transferência, ajuste, estorno, inventário) ou o modelo de saldos e movimentos.
---

# Domínio de estoque

- **Livro é a verdade**: `stock_movements` só recebe INSERT (gatilho bloqueia UPDATE/DELETE). `inventory_balances` e `inventory_cost_state` são derivados e só as funções `inv_*` os escrevem, na mesma transação do movimento.
- Toda operação é uma chamada atômica que nasce **confirmada** (D-E5); o único fluxo com aprovação é o inventário. Correção = `inv_reverse_operation` (movimentos compensatórios; a operação original só vai de confirmada para estornada, uma vez).
- Cada função começa por `private.inv_guard(org, nível[, depósito])`, valida entrada, abre a operação (`inv_open_op`: chave de idempotência + hash do pedido + advisory lock) e só então trava saldos e custo, **sempre na mesma ordem** (saldos por depósito/produto ordenados → estado de custo por produto).
- Estoque negativo é recusado sempre. Reservas não existem (disponível = físico).
- Transferência = saída + entrada; quantidade e valor consolidados não mudam; o valor por depósito é distribuído por maior resto na visão.
- Inventário: snapshot guarda esperado e versão do saldo; aprovação recusa itens cujo saldo mudou (`inv_reopen_stale_count`); diferença vira ajuste `count_in/out` com valor pelo custo médio (sobra sem custo exige `inv_count_set_surplus_cost`).
- Mudou regra de domínio: atualize `docs/INVENTORY_LEDGER.md`, os testes SQL 70/71, o teste de concorrência e (se for regra crítica) crie uma mutação em `scripts/mutation-check.mjs`.
