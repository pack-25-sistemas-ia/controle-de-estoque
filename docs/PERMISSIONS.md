# PERMISSIONS — Perfis e permissões

Papéis do Core (`org_role`) → perfis do produto. Autorização sempre no servidor **e** no banco (RLS + `private.inv_guard`, que exige sessão com MFA, papel e depósito autorizado); a interface só esconde, nunca protege.

| Ação | Administrador (owner/admin) | Gestor de estoque (manager) | Operador (member) | Consulta (viewer) |
|---|---|---|---|---|
| Membros, papéis, configurações da empresa | sim | não | não | não |
| Depósitos: criar/editar/arquivar; depósitos autorizados por operador | sim | criar/editar/arquivar | não | não |
| Unidades de medida | sim | sim | não | não |
| Categorias, fornecedores | sim | sim | ver | ver |
| Produtos: criar/editar/arquivar | sim | sim | criar e editar dados básicos* | ver |
| Parâmetros de reposição | sim | sim | não | ver |
| Entrada, saída, transferência | sim | sim | sim (nos depósitos autorizados) | não |
| Ajuste manual de saldo | sim | sim | **não** | não |
| Estorno de operação | sim | sim | **não** | não |
| Entrada com custo / alterar custo | sim | sim | informar custo na própria entrada | não |
| Inventário: contar | sim | sim | sim (nos depósitos autorizados) | não |
| Inventário: aprovar (gera ajustes) | sim | sim | **não** | não |
| Importar CSV | sim | sim | produtos e fornecedores (prévia e envio); **estoque inicial só gestor+** | não |
| Dashboards e relatórios (inclui custo médio e valor) | todos | todos | permitidos | permitidos |
| Exportar CSV (auditado) | sim | sim | não | não |
| Notificações | sim | sim | as do seu escopo | as do seu escopo |

\* Operador não altera parâmetros de reposição, não arquiva e não altera custo de operação já confirmada (nenhum perfil altera: só estorno).

Custo médio e valor do estoque ficam visíveis a todos os membros da empresa (o banco não separa colunas por papel); o que muda por perfil é **quem pode movimentar, ajustar, estornar e aprovar**.
Depósitos autorizados: `warehouse_access (user, warehouse)`. Se o operador tem linhas, só opera e conta nesses depósitos; sem linhas, em todos os ativos. Administrador e gestor não são restringidos.
