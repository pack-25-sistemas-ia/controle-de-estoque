# ARCHITECTURE — Controle de Estoque Inteligente

Base: Core do Pack (Next.js 16 App Router, TypeScript strict, Tailwind 4, Supabase Auth/Postgres/Storage) sincronizado por `scripts/sync-core.mjs`. Layout na raiz, sem `src/` (D-E1).

## Camadas
| Camada | Onde | Responsabilidade |
|---|---|---|
| Presentation | `app/(app)/*`, `components/inventory/*` | Telas, formulários (react-hook-form + Zod), tabelas, gráficos (Recharts, só no navegador via `dynamic ssr:false`), leitor de código, etiquetas |
| Application | `lib/inventory/actions/*`, `action-kit.ts` | Server Actions: validam sessão, papel e entrada (Zod) e chamam o banco por RPC; nunca recalculam regra |
| Domain | `lib/inventory/{qty,money,dates,barcode,filters,schemas,labels}.ts` | Funções puras espelho das regras do banco (parse de quantidade e custo em texto decimal, EAN/UPC, formatação) para UI e testes |
| Infrastructure | `lib/inventory/{data,dashboard,reports,csv,files,page}.ts`, `app/api/*`, `supabase/migrations` | Leituras Supabase, CSV estrito, tipo real de arquivo, exportação, anexos assinados |

## Onde moram as regras
**No banco**: entrada, saída, transferência, ajuste, estorno, custo médio, saldos, inventário, reposição, importação e métricas (SQL transacional + constraints + gatilhos de imutabilidade). O TypeScript só normaliza a digitação brasileira, pré-visualiza e formata. Nenhuma tela calcula saldo, custo ou indicador por conta própria.

## Fluxo de uma saída
Formulário (itens por SKU/código, Enter) → ação do servidor (sessão, papel, Zod, chave de idempotência gerada na abertura do formulário) → RPC `inv_post_issue(org, depósito, motivo, itens, …, chave)` → guarda (MFA, papel, depósito autorizado) → advisory lock da chave → trava saldos (depósito, produto) em ordem → trava estados de custo → valida saldo → grava operação, itens e movimentos com valor proporcional → atualiza saldos e custo → auditoria → devolve o id. Repetir com a mesma chave devolve a mesma operação.

## Fronteiras de segurança
RLS por `organization_id`; chaves compostas; sem `service_role`; Storage privado com URL assinada curta, autorizada pelo banco; CSP estrita (sem estilo em linha: etiqueta em canvas, imagem do produto via `/api/attachments/ID?inline=1`); `Permissions-Policy: camera=(self)`; logs sem PII nem valores; exportação CSV auditada e neutralizada.

## Leitura de código
Campo de texto com foco (leitor USB digita e envia Enter) é o caminho principal. Câmera: `BarcodeDetector` nativo quando existe; ZXing carregado sob demanda; só depois de um clique e com a permissão do navegador.

## Execução agendada
Não há processo permanente nem agendador: rotinas idempotentes (`inv_run_routines`) rodam ao abrir o painel ou pelo botão (DEPLOYMENT.md, item 4).
