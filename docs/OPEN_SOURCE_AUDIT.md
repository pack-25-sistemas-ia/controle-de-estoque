# OPEN_SOURCE_AUDIT — Controle de Estoque Inteligente

Pesquisa de 2026-10-14 (API do GitHub via `gh` e `npm view`). «Incorporado» = código copiado para este repositório. **Nenhum código de terceiros foi incorporado.** Projetos de estoque foram estudados como referência de modelagem e reimplementados em SQL próprio; bibliotecas entram apenas como dependências do pnpm.

| Projeto | URL | Licença (confirmada) | Estrelas | Último push | Commit analisado | Papel | Decisão |
|---|---|---|---|---|---|---|---|
| InvenTree | github.com/inventree/InvenTree | MIT | ~7,7 mil | 2026-10-14 | de962f5144 | Referência: peças, localizações, histórico de estoque, contagem, rastreabilidade | **Só referência** (backend Django; modelo próprio em SQL) |
| Medusa | github.com/medusajs/medusa | MIT, **exceto** materiais Enterprise (`ENTERPRISE-LICENSE.md`); API do GitHub retorna `NOASSERTION` | ~36,7 mil | 2026-10-13 | d37c79548b | Referência: inventory items/levels, reservas, ajustes, idempotência | **Só referência.** Nada Enterprise consultado como fonte de código |
| Saleor | github.com/saleor/saleor | BSD-3-Clause | ~23,4 mil | 2026-10-13 | a31848549f | Referência: estoque por depósito, alocação/reserva, consistência | **Só referência** (GraphQL/Django fora do escopo) |
| Saleor Dashboard | github.com/saleor/saleor-dashboard | BSD-3-Clause | ~1 mil | 2026-10-13 | e34cd91db8 | Referência de telas de estoque | **Só referência** |
| Grocy | github.com/grocy/grocy | MIT | ~9,6 mil | 2026-09-16 | 41206cb901 | Referência: operações rápidas, código de barras, uso em celular | **Só referência** (foco doméstico) |
| ExcelJS | github.com/exceljs/exceljs | MIT (npm 4.4.0) | ~15,5 mil | **2025-01-21** | 5bed18b45e | Importação/exportação XLSX | **Não adotado**: 21,8 MB, dependências antigas (`archiver@5`, `unzipper@0.10`, `fast-csv@4`), sem atividade há ~21 meses e leitura de planilha inteira em memória (ruim em serverless). XLSX fica fora do MVP; CSV cobre importação e exportação (D-E7) |
| SheetJS (`xlsx` no npm) | npm xlsx 0.18.5 | Apache-2.0 | — | — | — | Alternativa XLSX | **Não adotado**: versão do npm defasada com avisos de segurança conhecidos; a distribuição oficial está fora do npm |
| Papa Parse | github.com/mholt/PapaParse | MIT (npm 5.7.0, sem dependências) | ~13,6 mil | 2026-10-09 | e78dddce47 | Leitura de CSV | **Não adotado** por redundância: o módulo `lib/inventory/csv.ts` (leitura estrita com aspas, BOM, UTF-8/Windows-1252, separador detectado, neutralização de fórmulas) já existe, é testado e dispensa dependência (D-E7). Reavaliar se surgirem arquivos acima de 50 mil linhas |
| JsBarcode | github.com/lindell/JsBarcode | MIT (npm 3.12.3, sem dependências) | ~5,9 mil | 2026-06-23 | fbe17cbff8 | Etiquetas EAN-13/EAN-8/UPC-A/CODE128 em SVG | **Usar** (só no navegador, carregamento sob demanda) |
| ZXing JS | github.com/zxing-js/library | Apache-2.0 (npm `@zxing/library` 0.23.0; `@zxing/browser` 0.2.1 MIT) | ~2,9 mil | 2026-10-02 | 1722d0744f | Leitura de código pela câmera | **Usar como reserva**: `BarcodeDetector` nativo quando existir; ZXing carregado sob demanda quando não. Câmera sempre opcional (digitar/colar/leitor USB) |
| shadcn/ui | github.com/shadcn-ui/ui | MIT | ~125,5 mil | 2026-10-13 | 30a58d4498 | Kit de UI | **Não adotado**: o Core tem kit próprio (`components/ui`), mantido igual nos demais sistemas (D-E1) |
| TanStack Table | github.com/TanStack/table | MIT (8.21.3 usado no Pack) | ~28,5 mil | 2026-10-12 | 95c4768496 | Tabelas | **Usar** 8.21.3 (alinhado ao Pack) |
| ERPNext | github.com/frappe/erpnext | **GPL-3.0** | ~40,1 mil | 2026-10-13 | df5ab70ae6 | Referência: valorização, reposição, inventário | **Só inspiração conceitual.** Nada incorporado |
| Snipe-IT | github.com/grokability/snipe-it | **AGPL-3.0** | ~15 mil | 2026-10-14 | c6312a7499 | Referência: etiquetas, auditoria, histórico | **Só inspiração conceitual.** Nada incorporado |

Dependências novas sobre o Core (todas MIT/Apache-2.0, confirmadas com `npm view`; versões fixadas na instalação): `recharts`, `react-hook-form` + `@hookform/resolvers`, `@tanstack/react-table`, `decimal.js`, `date-fns`, `jsbarcode`, `@zxing/browser` + `@zxing/library`.

## O que foi aprendido de cada referência (ideias gerais, reimplementadas)
- **Livro de movimentos + saldo materializado** (InvenTree, Medusa, Saleor): o histórico é a fonte de verdade; o saldo é derivado e mantido na mesma transação. Reservas e disponibilidade são colunas separadas do saldo físico.
- **Concorrência** (Medusa/Saleor): atualização de nível com bloqueio de linha e verificação de condição dentro da transação; nunca «ler, calcular no cliente, sobrescrever».
- **Contagem física** (InvenTree/ERPNext): captura da quantidade esperada no início, diferença calculada, ajuste só na aprovação.
- **Valorização** (ERPNext): média móvel com valor acumulado; aqui o valor é guardado em centavos inteiros para não acumular erro (COSTING_RULES.md).
- **Operação rápida e leitor** (Grocy): foco automático no campo de código, Enter confirma, sem exigir câmera.

## Riscos
GPL/AGPL (ERPNext, Snipe-IT) são incompatíveis com a distribuição pretendida; as semelhanças são ideias gerais (saldo por depósito, contagem, histórico), expressas em modelo e código próprios. Medusa mistura MIT e Enterprise: só o conceito geral foi usado. ExcelJS/SheetJS descartados por manutenção e segurança.

## Situação final
Verificada em 2026-10-14 com `pnpm licenses list --prod`: 77 pacotes de produção, todos permissivos — MIT (57), ISC (12), Apache-2.0 (3), BSD-3-Clause (2), 0BSD (1), MIT AND ISC (1) e CC-BY-4.0 (1, `caniuse-lite`, dados de compatibilidade usados só na compilação). Nenhum GPL/AGPL/SSPL. **Nenhum código de terceiros foi incorporado**: ERPNext (GPL-3.0), Snipe-IT (AGPL-3.0), InvenTree, Medusa (inclusive materiais Enterprise), Saleor e Grocy foram só referência de ideias gerais, reimplementadas em modelo e código próprios. JsBarcode (MIT) e ZXing (Apache-2.0/MIT) são dependências carregadas só no navegador.
