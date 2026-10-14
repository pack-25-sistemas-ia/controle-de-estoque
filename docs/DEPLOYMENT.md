# DEPLOYMENT — Controle de Estoque Inteligente

Tudo é seu: seu projeto Supabase, seu repositório, sua hospedagem. Nada é enviado ao autor do Pack.

## Pré-requisitos
Node 22+, pnpm, Docker (só para o Supabase local e para `pnpm test:db`), conta Supabase (região **São Paulo** para dados pessoais) e hospedagem Node (ex.: Vercel).

## Variáveis (`.env.local`, nunca no git)
| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública do app |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do seu projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable/anon (segura no navegador, limitada pelo RLS) |

O app **não usa** `service_role`. Não a coloque em variável alguma.

## Banco e Storage
1. **Local**: `supabase start` (Storage habilitado) e `supabase db reset` (migrações + `seed.sql` fictício). As portas deste projeto são 584xx (`project_id = pack25-controle-de-estoque`) para não colidir com outros projetos Supabase locais. Em máquina com pouca memória: `supabase start -x realtime,imgproxy,studio,edge-runtime,logflare,vector`.
2. **Produção**: `supabase link --project-ref <ref>` e `supabase db push`. **Não** aplique `seed.sql` em produção (cria usuários de demonstração). A migração cria o bucket privado `inv-files` (10 MB; PDF, PNG, JPEG) com políticas por empresa.
3. **Autenticação** no painel do Supabase: confirmação de e-mail ligada, senha mínima de 12, **TOTP (MFA) habilitado** — as operações de estoque exigem sessão com segunda etapa —, **SMTP próprio** e a URL do app em Redirect URLs.
4. **Rotinas** (sugestões de reposição e avisos): rodam quando uma pessoa com perfil de operador ou acima abre o painel ou usa o botão «Atualizar sugestões e avisos agora». São idempotentes (repetir não duplica). Não há agendador: a função exige sessão com permissão, de propósito (nada executa «como administrador» sem identidade).
5. **Backup e restauração**: use os backups diários do Supabase (e *Point-in-Time Recovery* em plano pago). O livro é só-acréscimo; depois de restaurar rode `select * from public.inv_reconcile('<org>')`: nenhuma linha significa que saldos e valores fecham com o livro. Guarde exportações CSV mensais fora do Supabase.
6. **Reversão (rollback)**: as migrações são só para frente. Para voltar, restaure o backup anterior à migração; não apague movimentos à mão (os gatilhos impedem e a correção correta é o estorno).

## Aplicação
`pnpm install --frozen-lockfile` → `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → `pnpm start`.

**Corpo da requisição**: importações de CSV (até 5 MB e 5.000 linhas) e anexos usam envios de até 12 MB no proxy e 6 MB em Server Actions (`next.config.ts`). Algumas hospedagens serverless limitam o corpo a 4,5 MB; nelas reduza o arquivo ou ajuste o limite da plataforma. Anexos têm teto de 10 MB no Storage.

**E2E**: `pnpm test:e2e` usa o Supabase local e o app **compilado** (`pnpm build && pnpm start -p 3123`, a porta do `site_url`). Copie as URLs/chaves de `supabase status` para `.env.e2e` (ignorado pelo git) com `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_BASE_URL` e `E2E_MAILPIT_URL`. Rode **um arquivo por vez** (o limitador de login do app barra muitos logins em 10 minutos) e depois de um `supabase db reset` para os testes de demonstração.

**Windows**: use um caminho curto para a pasta (caminho longo quebra o Vitest/Vite).

## Dados de demonstração
Senha local única `DemoLocal#2026`, todos `@demo.exemplo`, empresa «Casa Boa Distribuidora Ltda.» (dados fictícios): `dono@` (administrador), `gestor@`, `operador@`, `consulta@` e `operador.loja@` (operador restrito ao depósito LOJA). Sem MFA obrigatório apenas por serem locais; em produção cada pessoa cadastra o TOTP no primeiro acesso. `pnpm seed:gen` regenera `supabase/seed.sql` e `seed-plan.json` (tudo para datas relativas a «hoje»).

## Checklist de produção
- [ ] Região Brasil; backups ligados; MFA ligado; SMTP próprio; Redirect URLs.
- [ ] `seed.sql` **não** aplicado; nenhuma chave `service_role` em variável de ambiente.
- [ ] Cadastrar depósitos, categorias e unidades; importar produtos por CSV e lançar o **saldo inicial** (importação «Saldo inicial») com data de abertura.
- [ ] Definir parâmetros de reposição (mínimo, ponto, alvo) dos produtos principais.
- [ ] Revisar o texto de privacidade com seu jurídico (controlador = quem implanta).
- [ ] Antivírus no envio de anexos se receber arquivos de terceiros (o sistema confere o tipo real e recusa PDF ativo, mas **não** é antivírus).
