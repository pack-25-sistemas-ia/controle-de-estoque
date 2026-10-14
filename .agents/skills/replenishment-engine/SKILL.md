---
name: replenishment-engine
description: Use ao mexer em parâmetros de reposição, classes de nível, sugestões, avisos de estoque ou nas rotinas automáticas.
---

# Reposição

- Parâmetros: mínimo ≤ ponto de reposição ≤ alvo, validados no banco e na tela; regra por depósito (`reorder_rules`) sobrescreve a do produto (`private.inv_effective_params`).
- Classes: `out_of_stock` (saldo 0), `critical` (≤ mínimo), `attention` (≤ ponto), `normal`. A classe vem de `private.inv_classify`; nunca recalcule no TypeScript.
- Sugestão = `max(0, alvo − saldo disponível)`. **Não inventar «em trânsito»**, reserva nem prazo de entrega no cálculo. Sugestão nunca cria pedido de compra.
- `inv_generate_suggestions` é idempotente: atualiza pendentes, dispensa as que deixaram de ser necessárias e não reabre uma já analisada sem nova entrada no depósito.
- Rotinas (`inv_run_routines`) rodam por pessoa autenticada (painel/botão); avisos têm chave diária para não duplicar.
- Mudou algo: teste SQL 71, E2E «reposição» em `inv-flow` e `docs/REPLENISHMENT.md`.
