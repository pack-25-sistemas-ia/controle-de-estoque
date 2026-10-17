# Controle de Estoque Inteligente

Controle de estoque **multiempresa** para comércio e distribuidores pequenos: produtos, depósitos, entradas, saídas, transferências, ajustes, inventário físico, reposição, importação CSV, etiquetas com código de barras, painel e relatórios. Next.js + TypeScript + Supabase (Postgres com RLS), com as regras de estoque e custo **dentro do banco**.

**Público:** comércio e distribuidores pequenos.
**Problema:** saldo divergente e falta de rastreio das movimentações.

![Painel](docs/screenshots/painel.png)

## O que faz
- **Livro de movimentos imutável**: toda alteração de saldo é um movimento registrado (quem, quando, por quê, saldo depois). Correção = **estorno** compensatório, nunca edição.
- **Saldo por produto e depósito**, calculado e mantido pelo banco na mesma transação; **estoque negativo bloqueado** sempre.
- **Custo médio ponderado móvel** em centavos inteiros (sem float); valor do estoque **gerencial** (não é valor contábil nem preço de venda).
- **Entradas, saídas, transferências, ajustes** (com justificativa) e **saldo inicial**; **idempotência** (duplo clique e reenvio não duplicam) e concorrência testada com sessões reais.
- **Inventário físico**: snapshot do esperado, contagem, aprovação com geração de ajustes, e recontagem obrigatória se o saldo mudou durante a contagem.
- **Reposição**: mínimo, ponto de reposição e alvo por produto/depósito; classes (normal, atenção, crítico, sem estoque) e sugestões — sem criar pedido de compra.
- **Importação CSV** (produtos, fornecedores, categorias, saldo inicial, regras de reposição) com prévia, erros por linha e confirmação atômica; **exportação CSV** auditada.
- **Etiquetas e códigos de barras** (EAN-13/EAN-8/UPC-A/CODE 128), código interno, leitor USB e câmera opcional.
- **Painel com 12 indicadores e 10 gráficos** e **18 relatórios**; avisos; anexos privados.
- **Perfis** administrador, gestor, operador (com depósitos autorizados) e consulta; MFA exigido nas operações; identidade visual própria (white-label); LGPD.

## Não faz (fora do escopo)
Emissão de NF-e, integração com marketplaces, reservas, WMS, lote/validade/série, XLSX/PDF, valor contábil ou fiscal.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Controle de Estoque: https://github.com/pack-25-sistemas-ia/controle-de-estoque
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.


## Começar
```bash
pnpm install
supabase start && supabase db reset     # banco local com dados fictícios (seed reproduzível)
cp .env.example .env.local              # preencha com as chaves de «supabase status»
pnpm dev
```
Empresa fictícia «Casa Boa Distribuidora Ltda.». Usuários locais (senha única `DemoLocal#2026`): `dono@demo.exemplo` (administrador), `gestor@demo.exemplo`, `operador@demo.exemplo`, `consulta@demo.exemplo` e `operador.loja@demo.exemplo` (só o depósito LOJA). Detalhes em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Qualidade
```bash
pnpm lint && pnpm typecheck && pnpm test      # lint, tipos, testes unitários
pnpm build
pnpm test:db                                  # Postgres 17 em Docker: testes SQL de motor, inventário, métricas, importação e acesso A×B
pnpm test:concurrency                         # sessões paralelas reais: sem saldo negativo, sem duplicidade, sem impasse
pnpm test:mutation                            # quebra regras críticas de propósito; todos os testes devem reprovar
pnpm test:e2e                                 # Playwright contra Supabase local e o app compilado
```
Os resultados reais de cada rodada estão em [MEMORY.md](MEMORY.md). O que não foi executado é dito como NÃO EXECUTADO.

## Documentação
[FEATURES](docs/FEATURES.md) · [Livro de movimentos](docs/INVENTORY_LEDGER.md) · [Regras de custo](docs/COSTING_RULES.md) · [Regras de estoque](docs/STOCK_RULES.md) · [Reposição](docs/REPLENISHMENT.md) · [Indicadores](docs/METRICS.md) · [Banco de dados](docs/DATABASE.md) · [Permissões](docs/PERMISSIONS.md) · [Arquitetura](docs/ARCHITECTURE.md) · [Decisões](docs/DECISIONS.md) · [Implantação](docs/DEPLOYMENT.md) · [Auditoria de código aberto](docs/OPEN_SOURCE_AUDIT.md)

## Privacidade (LGPD)
Risco estimado: **baixo**. Dados tratados: contato de fornecedores e e-mail/nome da equipe. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica. Isolamento por empresa (RLS), anexos privados com URL assinada, logs sem valores nem documentos, exportações auditadas.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no hub do Pack.
