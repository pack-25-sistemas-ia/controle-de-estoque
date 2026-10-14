// Configuração do Controle de Estoque Inteligente. Para personalizar para uma empresa:
//  1. troque `name`;  2. substitua public/brand/logo.svg;  3. ajuste a navegação em `primaryNav`.
// Papéis do Core → perfis de estoque: owner/admin = Administrador; manager = Gestor de estoque;
// member = Operador; viewer = Consulta (ver docs/PERMISSIONS.md).
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
// Itens de menu entram junto com as telas reais de cada módulo (nenhum link para página inexistente).
import type { OrgRole } from '@/lib/validation/org';

export type NavItem = { href: string; label: string; roles?: readonly OrgRole[] };

export const systemConfig: { name: string; logo: string; primaryNav: NavItem[] } = {
  name: 'Controle de Estoque Inteligente',
  logo: '/brand/logo.svg',
  primaryNav: [
    { href: '/dashboard', label: 'Painel' },
    { href: '/produtos', label: 'Produtos' },
    { href: '/saldos', label: 'Saldos' },
    { href: '/entradas', label: 'Entradas' },
    { href: '/saidas', label: 'Saídas' },
    { href: '/transferencias', label: 'Transferências' },
    { href: '/ajustes', label: 'Ajustes' },
    { href: '/movimentacoes', label: 'Histórico' },
    { href: '/inventarios', label: 'Inventário físico' },
    { href: '/reposicao', label: 'Reposição' },
    { href: '/etiquetas', label: 'Etiquetas' },
    { href: '/importacoes', label: 'Importações', roles: ['owner', 'admin', 'manager', 'member'] },
    { href: '/relatorios', label: 'Relatórios' },
    { href: '/categorias', label: 'Categorias' },
    { href: '/fornecedores', label: 'Fornecedores' },
    { href: '/depositos', label: 'Depósitos' },
    { href: '/notificacoes', label: 'Avisos' },
    { href: '/configuracoes', label: 'Config. de estoque', roles: ['owner', 'admin', 'manager'] },
  ],
};
