/**
 * Matriz de permissões do back office.
 *
 * Isto decide o que DESENHAR, não o que é permitido. A autorização real está no
 * Postgres: `is_admin()` / `is_super_admin()` nas policies e o guard no topo de
 * cada RPC `SECURITY DEFINER`. Se este arquivo mentir, o servidor recusa.
 *
 * Existe separado do componente por um motivo prático: o vitest deste projeto
 * roda em node, sem jsdom e sem testing-library. Regra em função pura é regra
 * testável; regra dentro de JSX não é.
 */

export type Papel = 'admin' | 'super_admin';

/** Áreas do back office — uma por entrada de menu. */
export type Recurso =
  | 'visao_geral'
  | 'usuarios'
  | 'parceiros'
  | 'comissoes'
  | 'receita'
  | 'auditoria'
  | 'configuracoes';

/** Ações sensíveis, que exigem checagem mais fina que "abrir a tela". */
export type Acao =
  | 'suspender_usuario'
  | 'reativar_usuario'
  | 'criar_parceiro'
  | 'editar_parceiro'
  | 'alterar_percentual'
  | 'gerar_link'
  | 'revogar_link'
  | 'aprovar_comissao'
  | 'pagar_comissao'
  | 'estornar_comissao'
  | 'registrar_receita'
  | 'estornar_receita'
  | 'conceder_papel'
  | 'revogar_papel'
  | 'exportar_dados';

const RECURSOS_ADMIN: readonly Recurso[] = [
  'visao_geral',
  'usuarios',
  'parceiros',
  'comissoes',
  'receita',
  'auditoria',
];

/** super_admin acumula os recursos de admin — quem pode tudo pode o menos. */
const RECURSOS_SUPER_ADMIN: readonly Recurso[] = [...RECURSOS_ADMIN, 'configuracoes'];

const ACOES_ADMIN: readonly Acao[] = [
  'suspender_usuario',
  'reativar_usuario',
  'criar_parceiro',
  'editar_parceiro',
  'alterar_percentual',
  'gerar_link',
  'revogar_link',
  'aprovar_comissao',
  'exportar_dados',
];

/**
 * O que só super_admin faz, e por quê:
 * - pagar/estornar comissão e registrar/estornar receita movem dinheiro;
 * - conceder/revogar papel é a própria hierarquia. Se um admin pudesse conceder,
 *   ele se promoveria a super_admin e a distinção não existiria.
 */
const ACOES_SUPER_ADMIN: readonly Acao[] = [
  ...ACOES_ADMIN,
  'pagar_comissao',
  'estornar_comissao',
  'registrar_receita',
  'estornar_receita',
  'conceder_papel',
  'revogar_papel',
];

function normalizar(papeis: readonly string[] | null | undefined): Papel[] {
  if (!papeis) return [];
  return papeis.filter((p): p is Papel => p === 'admin' || p === 'super_admin');
}

/** Tem algum papel administrativo? Só isto abre a rota /admin. */
export function ehAdmin(papeis: readonly string[] | null | undefined): boolean {
  return normalizar(papeis).length > 0;
}

export function ehSuperAdmin(papeis: readonly string[] | null | undefined): boolean {
  return normalizar(papeis).includes('super_admin');
}

export function podeAcessar(
  papeis: readonly string[] | null | undefined,
  recurso: Recurso,
): boolean {
  const meus = normalizar(papeis);
  if (meus.includes('super_admin')) return RECURSOS_SUPER_ADMIN.includes(recurso);
  if (meus.includes('admin')) return RECURSOS_ADMIN.includes(recurso);
  return false;
}

export function podeExecutar(
  papeis: readonly string[] | null | undefined,
  acao: Acao,
): boolean {
  const meus = normalizar(papeis);
  if (meus.includes('super_admin')) return ACOES_SUPER_ADMIN.includes(acao);
  if (meus.includes('admin')) return ACOES_ADMIN.includes(acao);
  return false;
}

/** Recursos visíveis, na ordem do menu. */
export function recursosVisiveis(papeis: readonly string[] | null | undefined): Recurso[] {
  const meus = normalizar(papeis);
  if (meus.includes('super_admin')) return [...RECURSOS_SUPER_ADMIN];
  if (meus.includes('admin')) return [...RECURSOS_ADMIN];
  return [];
}
