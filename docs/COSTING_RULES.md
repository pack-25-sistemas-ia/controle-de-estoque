# COSTING_RULES — Custo médio ponderado móvel (valor gerencial)

O valor é **gerencial**: não é valor contábil, fiscal nem preço de venda. Não há apuração tributária, escrituração nem FIFO/LIFO.

## Estado
Por produto (organização inteira, somando depósitos): `quantity_valued` (quantidade em estoque) e `total_value_cents` (valor acumulado, **inteiro em centavos**). O custo médio é derivado: `média = total_value_cents ÷ quantity_valued` (exibido com 4 casas; nunca é a fonte de verdade). Invariantes: `quantity_valued = Σ saldo físico do produto nos depósitos`; `total_value_cents ≥ 0`; `quantity_valued = 0 ⇒ total_value_cents = 0`.

Guardar o valor em centavos inteiros (e não a média) evita acúmulo de erro de arredondamento: o que entra e o que sai é conservado até o último centavo.

## Entrada com custo
`valor_entrada = arredondar_meio_par(quantidade × custo_unitário_centavos)` (o custo unitário aceita até 4 casas decimais de centavo; o arredondamento é meio-para-o-par, para um único valor inteiro por linha).
`novo_valor = valor_anterior + valor_entrada`; `nova_quantidade = quantidade_anterior + quantidade`.
Exemplo: 10 un a R$ 20,00 (R$ 200,00) + 10 un a R$ 30,00 (R$ 300,00) → 20 un, R$ 500,00, média R$ 25,00.

## Saída (venda, consumo, perda, avaria, devolução ao fornecedor, amostra, ajuste negativo)
Custo da saída = parte proporcional do valor acumulado **no instante anterior ao movimento**:
- se a saída zera o estoque (`quantidade = quantity_valued`): `valor_saída = total_value_cents` (leva o resto de centavos, sem sobra);
- senão: `valor_saída = arredondar_meio_par(total_value_cents × quantidade ÷ quantity_valued)`.
Exemplo: 20 un, R$ 500,00; saída de 4 → R$ 100,00; restam 16 un e R$ 400,00. O custo gravado em cada movimento nunca é recalculado.

## Transferência entre depósitos
Quantidade e valor consolidados do produto **não mudam**. Os dois movimentos carregam o mesmo valor (saída no custo médio vigente; entrada nesse mesmo valor). O valor por depósito exibido é a distribuição do valor total do produto proporcional ao saldo de cada depósito, pelo método do maior resto (a soma dos depósitos fecha exatamente com o total).

## Entradas sem custo informado (política explícita, nunca silenciosa)
| Operação | Custo |
|---|---|
| Compra | **obrigatório** (pode ser R$ 0,00 só se o usuário marcar «sem custo (bonificação)») |
| Saldo inicial / abertura | obrigatório |
| Devolução de cliente | custo do movimento de saída original, se referenciado (`reference_movement_id`); senão o usuário escolhe «custo médio atual» ou informa o custo |
| Ajuste positivo / sobra de inventário | «custo médio atual» (padrão da tela, visível e gravado em `cost_policy`) ou custo informado. Se `quantity_valued = 0` e não houver custo informado, a operação é recusada: não se inventa custo |

O campo `cost_policy` do movimento (`informed`, `average`, `original`, `none`) registra como o valor foi obtido.

## Estornos
- **Entrada estornada**: tira a quantidade e o **valor original da entrada**. Recusado se o saldo do depósito não cobrir a quantidade ou se o valor restante ficaria negativo, ou diferente de zero com quantidade zerada (custo inconsistente: é preciso estornar as saídas posteriores ou usar ajuste).
- **Saída estornada**: devolve a quantidade e o valor original da saída (a média muda conforme o estado atual; isso é esperado e registrado no evento de custo).
- Estorno de estorno: proibido.

## Eventos de custo
Cada movimento gera um registro em `inventory_cost_events` com quantidade e valor antes/depois e a média antes/depois, para a evolução do custo médio por produto (gráfico do produto) e para auditoria.

## Limitações declaradas
Média móvel por produto na organização (não por depósito); sem moeda estrangeira; sem custos adicionais rateados (frete, impostos) — o usuário informa o custo unitário já completo; sem recálculo retroativo de saídas.
