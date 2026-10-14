# MEMORY — CONTROLE DE ESTOQUE INTELIGENTE (controle-de-estoque)
Atualizado em: 2026-10-14 | Versão: 1.0.0 | Estado: VALIDADO (evidências abaixo; cópia exportada e CI do hub registrados no fechamento do hub)

## Missão do sistema
Saldo divergente e falta de rastreio das movimentações. Público: comércio e distribuidores pequenos. Valor: saldo confiável por depósito com movimentação auditável e alerta de mínimo.

## Stack e caminhos-chave
Next.js 16 (App Router) + TypeScript strict + Tailwind 4 + Supabase (Auth, Postgres/RLS, Storage); layout do Core na raiz, sem `src/` e sem shadcn (D-E1). Domínio em `lib/inventory/*` (qty, money, barcode, csv, reports, dashboard, actions), UI em `components/inventory/*`, banco em `supabase/migrations/2027070100*_inv_*.sql`. Portas locais 584xx (`project_id = pack25-controle-de-estoque`); E2E na porta 3123.
Comandos: pnpm lint | typecheck | test | build | test:db | test:concurrency | test:mutation | test:e2e | seed:gen.

## Escopo contratado do MVP
Produtos; fornecedores; depósitos; entradas, saídas e ajustes transacionais; estoque mínimo; histórico imutável — mais transferências, inventário físico, custo médio, reposição, importação CSV, etiquetas, painel (12 KPIs, 10 gráficos), 18 relatórios, avisos, anexos, perfis com depósitos autorizados.
Fora do escopo: NF-e; marketplaces; reservas; WMS; lote/validade/série; XLSX/PDF (D-E7).

## Implementado e verificado (2026-10-14, execuções reais nesta máquina)
- `pnpm lint`, `pnpm typecheck`: limpos. `pnpm test`: 114 testes unitários passam (6 arquivos).
- `pnpm test:db`: Core (10, 20, 30, 40) + 70 motor, 71 inventário/reposição, 72 métricas (totais à mão), 73 importação/anexos/exportação: todos passam.
- `pnpm test:concurrency`: 8 cenários com sessões reais (sem impasse, sem saldo negativo, custo consolidado exato, 1 aprovação de inventário em 5 simultâneas) passam.
- `pnpm test:mutation`: **61/61 mutações reprovadas** (rodado sem outra carga).
- `pnpm test:e2e` (após `supabase db reset`, app recompilado na 3123): **49/49** — Core + inv-demo 6, inv-flow 14, inv-security 11 (18 cenários do §29), inv-ui 5 (+ capturas opcionais com E2E_SHOTS=1).
- Licenças: 77 pacotes de produção, todos permissivos (sem GPL/AGPL); nenhum código de terceiros incorporado (OPEN_SOURCE_AUDIT).

## Pendências e riscos
- **O prompt do Sistema 07 chegou truncado na seção 31 (skills)**: faltam testes, critérios de aceite, fases e relatório final do texto original (D-E13). Reconciliar com o Word íntegro quando disponível.
- Limites documentados: só CSV; sem reservas/«em trânsito»; sem lote/validade; câmera depende do navegador (não testada em CI); custo é gerencial.
- Risco LGPD: baixo (contato de fornecedores).

## Decisões relevantes
D-E1..D-E16 em docs/DECISIONS.md. Destaques: livro como verdade e valor em centavos inteiros acumulados (D-E2, D-E6, D-E8); estoque negativo sempre bloqueado (D-E9); número de operação por sequência global, numeração por empresa na visão (D-E14, a mutação de concorrência achou a linha quente); rotinas por pessoa autenticada, sem agendador (D-E16).

## Armadilhas (leia antes de mexer)
- Heredoc/`node -e` perdem barras invertidas e crases: use Write/Edit; `String.replace` com `$$` corrompe SQL (use função).
- `Input` do Core não aceita `ref`; React 19 reinicia formulários após ação (`use-inv-action`); `optionalText` precisa aceitar `undefined`.
- CSP `img-src 'self'` e sem estilo em linha: etiqueta em canvas; imagem de produto por `/api/attachments/ID?inline=1`.
- FK dupla para `organization_members` e `organizations` gera PGRST201 no Core (notificações só com FK para members).
- Teste de negação deve provar que a função existe (não aceitar 404/PGRST202).
- E2E: um arquivo por vez fora do CI (limitador de login 8/10 min); servidor `next start` pelo PowerShell Start-Process; `supabase db reset` antes de inv-demo; mutação sem carga paralela.

## Deploy
Não configurado (cada implantação usa o próprio Supabase). Veja docs/DEPLOYMENT.md.

## Referências
docs/FEATURES.md · INVENTORY_LEDGER · COSTING_RULES · STOCK_RULES · REPLENISHMENT · METRICS · DATABASE · PERMISSIONS · ARCHITECTURE · DECISIONS · DEPLOYMENT · OPEN_SOURCE_AUDIT · CHANGELOG_INTERNAL · .agents/skills/*
