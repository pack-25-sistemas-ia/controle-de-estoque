# STOCK_RULES — Regras de estoque, quantidades, produtos e reposição

## Quantidades
- `numeric(18,3)` no banco; no TypeScript, texto decimal validado e `decimal.js` só para exibição/pré-visualização (a regra vale no banco). Nada de `float`.
- A escala vem da unidade de medida do produto: «Unidade», «Caixa», «Pacote» = 0 casas; «Kg», «Litro», «Metro» = até 3. Quantidade com mais casas que a unidade permite é recusada.
- Entrada, saída e transferência recebem quantidade **positiva**; o sinal vem do tipo do movimento. Zero é recusado.
- Sem conversão implícita entre unidades. Uma unidade de estoque por produto; trocar a unidade de um produto com movimento é recusado.

## Estoque negativo
Bloqueado, sempre. `inventory_balances.quantity_on_hand >= 0` é um `check` do banco e cada função confere antes de gravar. Não existe configuração que permita negativo.

## Produtos
SKU único por organização (sem diferenciar maiúsculas); código de barras único por organização quando preenchido. Formatos aceitos: EAN-13, EAN-8, UPC-A (dígito verificador conferido) e código interno alfanumérico (CODE128, 3 a 48 caracteres). **Não** se gera nem se afirma GTIN oficial; a tela de etiqueta oferece «gerar código interno» (prefixo `INT-`). Produto com movimento não é excluído: só arquivado. Produto arquivado não recebe nova movimentação. Alterar cadastro nunca altera movimentos antigos.

## Depósitos
Não se exclui depósito com saldo ou histórico (arquivar exige saldo zero em todos os produtos). Depósito arquivado não recebe operações. Localizações internas (setor/prateleira): estrutura simples hierárquica no cadastro (`warehouse_locations`); os saldos continuam por depósito (sem WMS; D-E4).

## Reposição (sem previsão estatística)
Parâmetros por produto e, opcionalmente, por produto × depósito (`reorder_rules`; a regra por depósito vale sobre a do produto): `mínimo`, `ponto de reposição`, `estoque-alvo`, `prazo de entrega`, fornecedor preferencial.
Classificação do saldo disponível `d` (transparente e configurável pelos parâmetros): **Sem estoque** `d = 0`; **Crítico** `0 < d ≤ mínimo`; **Atenção** `mínimo < d ≤ ponto de reposição`; **Normal** `d > ponto de reposição`. Só entra na lista de reposição quem está em Sem estoque, Crítico ou Atenção.
Quantidade sugerida = `máx(0, estoque-alvo − d − em_trânsito)`, com `em_trânsito = 0` (o MVP não modela compras futuras e **não inventa** quantidade em trânsito). Sem estoque-alvo definido, a sugestão fica em branco para o usuário informar. Sugestões têm estado `pendente`, `analisada` ou `descartada` (nunca viram pedido de compra), são geradas de forma idempotente (uma pendente por produto × depósito) e atualizadas quando o saldo muda.

## Giro, cobertura e parados (observados, não previstos)
- **Saída operacional** = movimentos `issue` com motivo venda ou consumo interno. Transferência nunca conta. Perda, avaria, amostra, devolução ao fornecedor e ajuste aparecem em indicadores próprios.
- **Cobertura (dias)** = disponível ÷ (saída operacional dos últimos N dias ÷ N). Só é exibida com pelo menos 3 saídas operacionais em dias diferentes no período (N padrão 30); sem consumo observado mostra «sem consumo no período»; nunca divide por zero.
- **Giro (vezes)** = quantidade de saídas operacionais no período ÷ estoque médio no período, onde estoque médio = média do `balance_after` diário reconstruído (dia a dia) do período. Indisponível se o estoque médio for zero ou o produto tiver menos de 30 dias de histórico. Comparável só dentro da mesma unidade.
- **Parado** = sem saída operacional em N dias (30/60/90/180 ou personalizado) **e** produto criado há mais de N dias **e** com saldo > 0.

## Somas fisicamente válidas
Quantidades de unidades diferentes nunca são somadas: o painel mostra «Unidades em estoque» por unidade de medida e a contagem de SKUs. Valor gerencial (R$) pode ser somado (é dinheiro).

## Inventário físico
Rascunho → Em contagem → Aguardando aprovação → Concluído (ou Cancelado). Esperado e versão do saldo capturados no início; aprovar gera ajustes; saldo desatualizado exige recontagem. Detalhes em INVENTORY_LEDGER.md.
