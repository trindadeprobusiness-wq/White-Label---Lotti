/**
 * Papéis administrativos do usuário logado.
 *
 * Segue a convenção de chave de useCrm.ts:21-27 — uma factory por módulo, para
 * que invalidar `adminKeys.todos` derrube o cache do back office inteiro sem
 * caçar strings soltas pelo código.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { chamarRpc, BackOfficeNaoInstaladoError } from '@/lib/admin/api';
import { ehAdmin, ehSuperAdmin, type Recurso, podeAcessar, podeExecutar, type Acao } from '@/lib/admin/permissoes';
import { useAuth } from '@/hooks/useAuth';

export const adminKeys = {
  todos: ['admin'] as const,
  papeis: () => [...adminKeys.todos, 'papeis'] as const,
  metricas: (inicio: string, fim: string) =>
    [...adminKeys.todos, 'metricas', inicio, fim] as const,
  usuarios: (filtros: unknown) => [...adminKeys.todos, 'usuarios', filtros] as const,
  usuario: (id: string) => [...adminKeys.todos, 'usuario', id] as const,
  parceiros: (filtros: unknown) => [...adminKeys.todos, 'parceiros', filtros] as const,
  parceiro: (id: string) => [...adminKeys.todos, 'parceiro', id] as const,
  comissoes: (filtros: unknown) => [...adminKeys.todos, 'comissoes', filtros] as const,
  receita: (filtros: unknown) => [...adminKeys.todos, 'receita', filtros] as const,
  auditoria: (filtros: unknown) => [...adminKeys.todos, 'auditoria', filtros] as const,
};

export function usePapeis() {
  const { isAuthenticated, loading: carregandoSessao } = useAuth();

  const consulta = useQuery({
    queryKey: adminKeys.papeis(),
    queryFn: () => chamarRpc<string[]>('meus_papeis'),
    enabled: isAuthenticated,
    // Papel muda raramente e é consultado em toda navegação do painel.
    staleTime: 5 * 60_000,
    // Sem retry: `meus_papeis` só falha por falta de sessão ou por rede, e
    // insistir só atrasa o redirecionamento para /auth.
    retry: false,
  });

  const papeis = consulta.data ?? [];

  return {
    papeis,
    ehAdmin: ehAdmin(papeis),
    ehSuperAdmin: ehSuperAdmin(papeis),
    podeAcessar: (recurso: Recurso) => podeAcessar(papeis, recurso),
    podeExecutar: (acao: Acao) => podeExecutar(papeis, acao),
    // A sessão precisa resolver antes: sem ela a query nem dispara, e um
    // `carregando: false` prematuro faria o guard redirecionar quem é admin.
    carregando: carregandoSessao || (isAuthenticated && consulta.isLoading),
    erro: consulta.error,
    // Distinto de "sem papel": aqui a função sequer existe no banco, e o que
    // falta é rodar as migrations — não conceder permissão a alguém.
    naoInstalado: consulta.error instanceof BackOfficeNaoInstaladoError,
  };
}

/** Limpa o cache do back office — usar ao trocar de sessão. */
export function useInvalidarAdmin() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: adminKeys.todos });
  }, [qc]);
}
