---
name: inventory-security
description: Use ao criar tabelas, funções, rotas, anexos, exportações ou testes de acesso do estoque (RLS, MFA, papéis, depósitos autorizados, CSV, arquivos).
---

# Segurança do estoque

- Toda tabela de negócio: `organization_id`, RLS, FKs compostas `(id, organization_id)`. Nada de `service_role` no app. Funções `SECURITY DEFINER` com `set search_path = ''`, `EXECUTE` revogado de `public`/`anon` e liberado só a `authenticated`.
- Níveis: `read` (consulta), `operator` (operador), `manager` (gestor), `admin`. Operador pode ter **depósitos autorizados** (`warehouse_access`; sem linhas = todos) e `inv_guard` confere o depósito. Ajuste, estorno, exportação e parâmetros de reposição exigem gestor.
- MFA: o banco recusa operações sem `aal2` quando o Core exige; os E2E criam a segunda empresa com TOTP.
- **Teste de negação precisa provar que a função existe**: não aceite 404/PGRST202 como «negado»; use `expectDenied` de `tests/e2e/inv-security.spec.ts` e inclua um controle positivo (quem pode, consegue).
- Anexos: bucket privado `inv-files`, caminho opaco `<org>/<uuid>.<ext>`, tipo pelos **bytes** (PNG/JPEG/PDF), PDF com JavaScript/ação automática recusado, URL assinada curta só depois de o banco autorizar.
- CSV: separador `;`, BOM, neutraliza `=`, `+`, `-`, `@`, TAB e CR no início de texto (`safeCell`); exportação grava `audit_log` (quem, qual relatório, quantas linhas — nunca valores).
- Logs e auditoria sem PII nem valores. CSP estrita; não adicione estilo em linha nem `unsafe-inline`.
- Tabela nova com FK para `organization_members` **e** `organizations` quebra o embed do Core (PGRST201).
