# METRICS — Controle de Estoque Inteligente

Todos os indicadores, gráficos e relatórios vêm de funções SQL (`inv_dashboard_kpis`, `inv_dashboard_series`, `inv_product_stats`, `inv_report_turnover`, `inv_report_idle`, visões `inv_stock_view` e `inv_operations_view`). A tela só formata. Valores são **gerenciais** (custo médio ponderado móvel): não são valor contábil, fiscal nem preço de venda. **Quantidades de unidades diferentes nunca são somadas** (o painel mostra «1.074,1 kg · 9.818 un»).

## Indicadores (12)
| Indicador | Definição |
|---|---|
| Produtos ativos | SKUs com status ativo e não arquivados, dentro dos filtros |
| Unidades em estoque | Soma das quantidades **por unidade de medida** + nº de SKUs com saldo |
| Valor gerencial do estoque | Σ valor acumulado (centavos inteiros) do estado de custo; a distribuição por depósito usa maior resto, então a soma por depósito fecha com o total |
| Abaixo do mínimo | Pares produto × depósito em nível **crítico** (saldo ≤ mínimo); «atenção» (≤ ponto de reposição) é contado à parte |
| Sem estoque | Produtos ativos com histórico de movimento e saldo zero |
| Entradas no período | Nº de operações, quantidades por unidade e valor das entradas confirmadas (não estornadas); transferências não entram |
| Saídas operacionais | Venda e consumo interno: operações, quantidades e **custo**; perdas/avarias aparecem como «outras saídas» |
| Transferências | Operações de transferência concluídas (não são entrada nem saída) |
| Produtos parados | Com saldo e sem saída operacional há mais de N dias (padrão 90; produto novo não conta) |
| Divergências de inventário | Itens com diferença contado × esperado em inventários concluídos no período |
| Cobertura (mediana) | Saldo ÷ consumo médio diário da janela (padrão 90 dias); só produtos com ≥ 3 dias de saída; «—» quando não há dado suficiente |
| Ajustes no período | Nº e valor absoluto de ajustes **manuais** (inventário fica em «Divergências») |

Operações estornadas e seus estornos são excluídos dos totais de entradas/saídas para não contar duas vezes.

## Gráficos (10, cada um com tabela acessível equivalente)
Entradas × saídas por período · Evolução do valor do estoque · Valor por categoria · Estoque por depósito · Produtos abaixo do mínimo · Maiores saídas (custo) · Produtos por situação · Giro por categoria · Ajustes de inventário por período · Movimentações por tipo.

## Giro e cobertura
- **Giro** = quantidade saída operacionalmente no período ÷ saldo médio diário (em quantidade, por produto) no período. Indisponível («—») quando o saldo médio é zero. No painel, o giro por categoria vem ao lado do custo das saídas.
- **Cobertura (dias)** = saldo atual ÷ média diária de saída operacional na janela. Sem histórico suficiente não se inventa número.

## 18 relatórios (todos com CSV auditado)
Saldo atual por produto · Saldo por depósito · Estoque por categoria · Movimentações por período · Entradas · Saídas · Transferências · Ajustes · Inventários · Abaixo do mínimo · Sem estoque · Parados · Giro · Cobertura · Valorização gerencial · Custo médio · Produtos por fornecedor · Sugestões de reposição. O CSV usa `;`, BOM UTF-8, neutraliza fórmulas (`=`, `+`, `-`, `@`) e registra em `audit_log` quem exportou, qual relatório e quantas linhas (nunca os valores).

## Dados de conferência (teste SQL 72, datas fixas, «hoje» = 2025-06-15)
O teste reconstrói à mão o resultado e compara com as funções:
| Produto | Sequência | Resultado |
|---|---|---|
| A (un) | compra 100 × R$ 10,00 · venda 30 · compra 20 × R$ 15,00 · venda 10 · transferência 20 (WH1→WH2) · venda 5 (WH2) · venda 54 (WH1) | 21 un, **R$ 233,33** (WH1 6 un = R$ 66,67; WH2 15 un = R$ 166,66 — maior resto) |
| B (kg) | compra 20 × R$ 5,00 · perda 2 · venda 3 | 15 kg, **R$ 75,00** |
| C (un) | compra 10 × R$ 20,00, sem saídas | 10 un, **R$ 200,00** |
| Total | 233,33 + 75,00 + 200,00 | **R$ 508,33** (50.833 centavos) |

Saídas: 30 × 10,00 = 300,00; 10 × 11,111 → 111,11; 5 × 11,111 → 55,56; 54 × 11,111 → 600,00 (valor proporcional com arredondamento meio-para-o-par; quando a saída zera o saldo do produto, ela leva todo o valor restante).

## Como conferir um número
1. Painel → «Valor gerencial» = Relatórios → «Valorização gerencial» (total) = Σ `inventory_cost_state.total_value_cents`.
2. `select public.inv_reconcile(org)` compara saldo e valor com o livro inteiro e não deve devolver nenhuma linha (cada linha é uma divergência) (teste SQL 70 e E2E inv-demo recalculam pelo livro, de forma independente).
