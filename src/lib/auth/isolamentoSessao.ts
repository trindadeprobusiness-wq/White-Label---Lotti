import type { QueryClient } from '@tanstack/react-query';
import { useCRMStore } from '@/stores/crmStore';

/**
 * Remove todo dado do usuário anterior quando o dono da sessão muda.
 *
 * As chaves antigas do React Query não carregavam o tenant. Com staleTime,
 * indicadores do corretor A podiam continuar visíveis por até um minuto após
 * o corretor B entrar no mesmo navegador. O Zustand também mantinha listas e
 * o perfil em memória. Limpar os dois caches na fronteira de autenticação
 * protege todas as telas, inclusive as que ainda usam query keys legadas.
 */
export function isolarTrocaDeSessao(
  usuarioAnterior: string | null | undefined,
  usuarioAtual: string | null,
  queryClient: QueryClient,
): boolean {
  // undefined significa que a sessão inicial ainda está sendo descoberta; não
  // há usuário anterior conhecido e, portanto, nada para limpar.
  if (usuarioAnterior === undefined || usuarioAnterior === usuarioAtual) return false;

  queryClient.clear();
  useCRMStore.getState().limparDadosDaSessao();
  return true;
}
