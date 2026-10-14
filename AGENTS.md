# AGENTS — Controle de Estoque Inteligente

Sistema 07 do Pack 25 Sistemas IA (controle-de-estoque). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS; toda mutação valida sessão, papel e entrada (Zod) no servidor e chama função `inv_*`.
- Nunca commitar segredos; o app não usa service-role; jamais com prefixo NEXT_PUBLIC_.
- Dados pessoais mínimos; sem PII nem valores em logs; sem dados reais de cliente em seed.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db (Docker) · pnpm test:concurrency · pnpm test:mutation · pnpm test:e2e (Supabase local + app **recompilado**, porta 3123, um arquivo por vez) · pnpm seed:gen

## Regras do sistema
- **Livro é a verdade**: `stock_movements` é só-acréscimo; `inventory_balances` e `inventory_cost_state` são derivados e só as funções `inv_*` os escrevem, na mesma transação. Correção = estorno compensatório (uma vez). Operação só muda confirmada → estornada.
- **Sem float**: quantidade `numeric(18,3)` (escala por unidade, texto decimal no TS via `decimal.js`/`qty.ts`); dinheiro `bigint` em centavos; valor do estoque acumulado em centavos inteiros (a média é derivada). Saída = valor proporcional, meio-para-o-par; zerar leva todo o valor. Transferência não altera o custo consolidado.
- **Estoque negativo** é bloqueado sempre (check + verificação sob trava). Reservas fora do MVP.
- **Ordem de travas única**: saldos (depósito, produto) em ordem → estado de custo por produto. Nunca travar na ordem inversa; não reintroduzir contador por empresa (linha quente): número da operação vem da sequência global e a numeração por empresa é da visão.
- **Idempotência**: toda operação recebe chave; mesma chave + mesmo conteúdo devolve a mesma operação; conteúdo diferente é recusado. A chave nasce na abertura do formulário (`use-inv-action.ts`).
- Funções `inv_*` são SECURITY DEFINER e começam por `private.inv_guard(org, nível[, depósito])` (MFA + papel + depósito autorizado). Visões são `security_invoker`. FKs compostas `(id, organization_id)`.
- Tabela nova com FK para `organization_members` **e** para `organizations` torna o embed do Core ambíguo (PGRST201 e todos caem no onboarding): o teste do Core impede.
- Anexos: bucket privado `inv-files`, caminho opaco, tipo pelos bytes, URL assinada curta só após o banco autorizar. CSV exportado neutraliza fórmulas e é auditado.
- CSP estrita: sem estilo em linha (etiqueta em canvas; `img-src 'self'` → imagem de produto via `/api/attachments/ID?inline=1`); gráficos só no navegador.
- Mudou regra crítica de banco: rode `pnpm test:mutation` **sem outra carga na máquina** (todas as mutações devem morrer; crie mutação nova para regra nova) e `pnpm test:concurrency`.
- Cuidados: `String.replace` com `$$` corrompe SQL (use Edit ou função); heredoc/`node -e` perdem barras invertidas e crases (use Write/Edit); o `Input` do Core não aceita `ref`; React 19 reinicia formulários após toda ação; logins repetidos nos E2E esbarram no limitador (reaproveite a sessão); teste de negação deve provar que a função existe (não aceitar 404/PGRST202); não pare containers Supabase de outros projetos.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, concorrência real, mutação, fluxos críticos em Playwright, mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
