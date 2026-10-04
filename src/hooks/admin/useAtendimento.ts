import { useQuery } from '@tanstack/react-query';
import { chamarRpc } from '@/lib/admin/api';
import { adminKeys } from './usePapeis';

export interface ContaAtendimento {
  corretor_id: string; nome: string; email: string; status: string;
  criado_em: string; ultimo_acesso_em: string | null;
  parceiro_id: string | null; parceiro_nome: string | null; campanha: string | null;
  total_cliques: number; primeiro_clique_em: string | null;
  plano_nome: string | null; assinatura_status: string | null; receita_confirmada: number;
  onboarding_concluido_em: string | null; onboarding_etapa: string | null;
}

export function useOpcoesParceiros() {
  return useQuery({
    queryKey: [...adminKeys.todos, 'opcoes-parceiros'],
    queryFn: () => chamarRpc<{ id: string; nome: string }[]>('admin_opcoes_parceiros'),
    retry: false,
  });
}

export function useAtendimento(filtros: { busca: string; status: string; origem: string; campanha: string; pagina: number }) {
  return useQuery({
    queryKey: [...adminKeys.todos, 'atendimento', filtros],
    queryFn: () => chamarRpc<{ itens: ContaAtendimento[]; total: number }>('admin_listar_atendimento', {
      p_busca: filtros.busca.trim() || null,
      p_status: filtros.status === 'todos' ? null : filtros.status,
      p_parceiro_id: ['todos', 'direta'].includes(filtros.origem) ? null : filtros.origem,
      p_origem_direta: filtros.origem === 'direta',
      p_campanha: filtros.campanha.trim() || null,
      p_limite: 25, p_offset: (filtros.pagina - 1) * 25,
    }),
    retry: false,
    placeholderData: (anterior) => anterior,
  });
}
