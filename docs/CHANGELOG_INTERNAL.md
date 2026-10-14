# CHANGELOG_INTERNAL — Controle de Estoque Inteligente

Histórico de construção (não é changelog de produto). Datas de 2026-10-14.

| Fase | O que entrou | Lição |
|---|---|---|
| 1 Pesquisa e plano | Auditoria de licenças (GPL/AGPL só como inspiração), decisões D-E1..D-E13, livro de movimentos, regras de custo, estoque e permissões | O prompt colado veio truncado na seção 31 (D-E13) |
| 2 Base | Core sincronizado, dependências extras, `system.config` | Layout do Core na raiz, sem `src/` (D-E1) |
| 3 Banco e motor | Migrações schema, guardas, motor (entrada, saída, transferência, ajuste, saldo inicial, estorno, reconciliação); testes SQL 70; concorrência com largada sincronizada | Valor em centavos inteiros acumulados, não média arredondada: a conservação fecha até o último centavo |
| 4 Inventário e reposição | Snapshot com versão do saldo, aprovação bloqueada se o saldo mudou, reposição idempotente, avisos; teste 71 | Sugestão não inventa «em trânsito»; analisada não reabre sem nova entrada |
| 5 Métricas | 12 indicadores, 10 séries, giro, cobertura, parados; fixture de datas fixas com totais à mão (teste 72) | Teste de métrica não usa `now()`: «hoje» é parâmetro |
| 6 Anexos, exportação, importação | Bucket privado, tipo pelos bytes, CSV auditado, importação com prévia validada no banco; teste 73 | PGRST201: notificações referenciam só `organization_members` |
| 7 Mutação e linha quente | ~62 mutações; a rodada de concorrência mostrou que o contador de operações por empresa serializava tudo | Trocado por sequência global; o número «por empresa» é calculado na visão `inv_operations_view` (D-E14) |
| 8 Interface | 18 telas, editor de itens por código, câmera opcional, etiquetas em canvas, gráficos com tabela acessível | CSP bloqueia estilo de SVG e `img-src` é só `self`: etiqueta em canvas e imagem via rota assinada |
| 9 Testes de ponta a ponta | `inv-demo`, `inv-flow`, `inv-security` (18 cenários), `inv-ui` | `optionalText` rejeitava `undefined`: o E2E achou o bug real; negação em teste de segurança precisa provar que a função existe (não aceitar 404) |
| 10 Fechamento | Documentação, skills internas, mutação final, CI no hub, instalação isolada | — |
