---
name: stock-calculations
description: Use ao calcular, arredondar, validar ou formatar quantidades, custo unitário, custo médio, valor do estoque, giro e cobertura.
---

# Cálculos de estoque

- **Nunca float.** Quantidade = `numeric(18,3)` no banco, com escala por unidade (0–3 casas, imutável depois do primeiro movimento); no TypeScript é **texto decimal** processado por `decimal.js` (`lib/inventory/qty.ts`). Dinheiro = `bigint` em centavos (`money.ts`). Custo unitário aceita até 4 casas de centavo.
- Digitação brasileira: `parseQty('1.234,5', 3)` → `'1234.5'`. Em unidade sem casas o ponto é milhar; com casas, ponto único é decimal. Recusa texto, zero (quando não permitido), negativo, excesso de casas e acima do teto (999.999.999.999,999).
- **Valor do estoque = centavos inteiros acumulados por produto** (não média × saldo arredondada). Entrada soma o valor da linha (quantidade × custo, meio-para-o-par). Saída tira `valor × saída ÷ saldo` (meio-para-o-par); quando a saída zera o saldo, leva **todo** o valor. Custo médio = valor ÷ quantidade, derivado (nunca gravado como verdade).
- Distribuição por depósito: maior resto (a soma fecha com o total). Mesmos casos nos testes SQL 70/72 e em `tests/unit/inventory-qty-barcode-csv.test.ts`.
- Compra sem custo é recusada; custo zero só com bonificação marcada. Ajuste de saída e saída usam o custo médio vigente.
- Giro = saída operacional (quantidade) ÷ saldo médio diário; cobertura = saldo ÷ consumo médio diário da janela, só com ≥ 3 dias de saída. Sem dado suficiente: «—», nunca um número inventado.
- Mudou fórmula: atualize espelho TS, testes SQL e unitários, `docs/COSTING_RULES.md` e `docs/METRICS.md`.
