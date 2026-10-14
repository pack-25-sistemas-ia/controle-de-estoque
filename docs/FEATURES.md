# FEATURES — Controle de Estoque Inteligente
Status: VERIFIED (com evidência: arquivo/teste), FORA DO MVP ou LIMITE DOCUMENTADO. Nesta versão todos os fluxos abaixo estão VERIFIED.
Siglas de evidência: **SQL** = `supabase/tests/NN_*.sql` (`pnpm test:db`); **CONC** = `scripts/test-concurrency.mjs`; **MUT** = `scripts/mutation-check.mjs`; **UNIT** = `tests/unit/*`; **E2E** = `tests/e2e/*` (Playwright contra Supabase local e o app compilado).

| Fluxo | Status | Evidência |
|---|---|---|
| Produtos (SKU e código de barras únicos, unidade com 0–3 casas, tipo, categoria, parâmetros de reposição, arquivamento) | VERIFIED | SQL 70, 73; UNIT inventory-qty-barcode-csv; E2E inv-flow (cadastro, duplicidade, EAN inválido) |
| Fornecedores, produtos por fornecedor, categorias hierárquicas, unidades de medida | VERIFIED | SQL 70, 73; E2E inv-flow, inv-demo |
| Depósitos, localizações internas e **depósitos autorizados** por operador | VERIFIED | SQL 70; E2E inv-flow (código único), inv-security (operador restrito) |
| Entrada (compra, devolução, outras) com custo médio ponderado | VERIFIED | SQL 70; CONC; E2E inv-flow (10×R$ 20 + 10×R$ 30 → média R$ 25,00) |
| Saída (venda, consumo, perda, avaria…) com valor pelo custo médio; saldo insuficiente recusado | VERIFIED | SQL 70; CONC; MUT; E2E inv-flow |
| Transferência entre depósitos (quantidade e valor consolidados conservados) | VERIFIED | SQL 70; CONC (sem impasse); E2E inv-flow |
| Ajuste manual com justificativa obrigatória (perfil gestor) | VERIFIED | SQL 70; E2E inv-flow, inv-demo |
| Saldo inicial (abertura) | VERIFIED | SQL 70, 73 |
| Estorno compensatório (uma vez só; operação original só muda confirmada → estornada) | VERIFIED | SQL 70; CONC (estorno × estorno); MUT; E2E inv-flow |
| Livro de movimentos imutável (UPDATE/DELETE bloqueados, até para o gestor) | VERIFIED | SQL 70; MUT; E2E inv-security (10–12) |
| Estoque negativo bloqueado no banco, sem configuração para liberar | VERIFIED | SQL 70; CONC; E2E inv-security (15) |
| Idempotência (duplo clique, reenvio, mesma chave com outro conteúdo) | VERIFIED | SQL 70; CONC; E2E inv-flow (duplo clique), inv-security (13–14) |
| Reconciliação: saldo = soma do livro; valor = soma dos valores | VERIFIED | SQL 70 (`inv_reconcile`); E2E inv-demo (recálculo independente) |
| Inventário físico: snapshot, contagem, sobras/faltas, aprovação, ajustes, recontagem se o saldo mudou | VERIFIED | SQL 71; CONC; E2E inv-flow |
| Reposição: classes normal/atenção/crítico/sem estoque, sugestões idempotentes, «analisada» sem criar pedido | VERIFIED | SQL 71; E2E inv-flow, inv-demo |
| Avisos (mínimo, sem estoque, inventário, sugestões) e preferências | VERIFIED | SQL 71; E2E inv-demo (painel e tela de avisos) |
| Painel: 12 indicadores e 10 gráficos (com tabela acessível), todos vindos do banco | VERIFIED | SQL 72 (totais à mão); E2E inv-demo (confere com recálculo pelo livro) |
| 18 relatórios e exportação CSV auditada (separador `;`, BOM, fórmulas neutralizadas) | VERIFIED | SQL 72, 73; UNIT inventory-qty-barcode-csv; E2E inv-demo (18 abrem), inv-flow (CSV) |
| Importação CSV (produtos, fornecedores, categorias, saldo inicial, regras de reposição): prévia, duplicidade, erros, confirmação atômica | VERIFIED | SQL 73; UNIT inventory-qty-barcode-csv; E2E inv-flow |
| Etiquetas e códigos de barras (EAN-13/EAN-8/UPC-A/CODE 128), código interno, impressão | VERIFIED | UNIT inventory-qty-barcode-csv; E2E inv-flow |
| Leitura por teclado/leitor USB (busca por SKU/código) e câmera opcional | VERIFIED (câmera: LIMITE DOCUMENTADO) | E2E inv-flow (SKU + Enter); câmera depende do navegador e não é testada em CI |
| Anexos privados (imagem do produto, documentos da operação): tipo pelos bytes, PDF ativo recusado, URL assinada | VERIFIED | SQL 73; UNIT inventory-files; E2E inv-flow, inv-security |
| Isolamento entre empresas (RLS A×B) e MFA nas operações | VERIFIED | SQL 10, 30; E2E inv-security (1–6, 16, 18) |
| Perfis: administrador, gestor, operador, consulta | VERIFIED | SQL 70; E2E inv-demo, inv-security |
| Identidade visual (white-label), equipe e privacidade (LGPD) do Core | VERIFIED | SQL 10, 20, 40 (Core); lint/tipos/build |
| Acessibilidade estrutural, celular (sem rolagem lateral) e tema escuro | VERIFIED | E2E inv-ui |
| Seed reproduzível «Casa Boa Distribuidora Ltda.» (40 produtos, 3 depósitos, 248 operações) | VERIFIED | `pnpm seed:gen`; E2E inv-demo |

## Limites documentados (não são pendência)
- **XLSX e PDF** não são lidos nem gerados (D-E7): só CSV.
- **Reservas** e **«em trânsito»** fora do MVP (D-E10): disponível = físico; transferências são instantâneas.
- Custo é **gerencial** (médio ponderado móvel), não contábil nem fiscal; sem NF-e nem marketplaces.
- Lote, validade e número de série não existem nesta versão.
- Leitura por câmera é opcional e depende do navegador (BarcodeDetector ou ZXing); o caminho principal é digitar/leitor USB.
