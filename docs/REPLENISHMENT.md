# REPLENISHMENT — Reposição de estoque

Objetivo: avisar **o que** repor e **quanto**, sem criar pedido de compra (fora do MVP) e sem inventar dados.

## Parâmetros
Por produto: **mínimo**, **ponto de reposição** e **estoque-alvo**, com a ordem `mínimo ≤ ponto ≤ alvo` validada no banco e na tela. Podem ser sobrescritos por **regra por depósito** (`reorder_rules`, também importável por CSV). Vale a regra do depósito quando existe; senão, a do produto (`private.inv_effective_params`).

## Classes (por produto × depósito)
| Classe | Condição |
|---|---|
| Sem estoque (`out_of_stock`) | saldo = 0 |
| Crítico (`critical`) | saldo ≤ mínimo |
| Atenção (`attention`) | saldo ≤ ponto de reposição |
| Normal | acima do ponto (ou sem parâmetros) |

## Sugestão
`quantidade sugerida = max(0, alvo − saldo disponível)`; sem alvo, a sugestão traz só a situação. **Não existe «em trânsito»** (transferências são instantâneas) nem reserva (D-E10); o disponível é o saldo físico. A quantidade é ajustável pela pessoa ao analisar.

## Ciclo da sugestão
1. `inv_run_routines` (ao abrir o painel, pelo botão «Atualizar sugestões e avisos agora» ou por `pg_cron`) chama `inv_generate_suggestions`, **idempotente**: não duplica pendentes, atualiza quantidade/saldo das que já existem e **dispensa** as que deixaram de ser necessárias.
2. A pessoa marca **analisada** (com a quantidade que pretende pedir) ou **dispensada**. Nenhum pedido é criado.
3. Uma sugestão já analisada **não reabre** enquanto nada tiver entrado naquele depósito depois da análise; uma nova entrada que não resolva a falta permite nova sugestão.

## Avisos
`inv_run_routines` também gera avisos (sem estoque, abaixo do mínimo, reposição sugerida; e «importação sem linhas válidas» ao importar) com chave diária, então repetir a rotina no mesmo dia não duplica. Preferências por pessoa (`inv_notification_prefs`).

## Evidências
SQL 71 (classes, ordem dos parâmetros, idempotência, não reabrir, regra por depósito, isolamento), E2E inv-flow («reposição»), inv-demo (27 sugestões pendentes no seed), SQL 73 (importação de regras).
