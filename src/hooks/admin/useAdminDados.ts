/**
 * Acesso a dados do back office.
 *
 * Segue o padrão de src/hooks/crm/useCrm.ts — o mais recente do projeto e o
 * único com convenção de chave documentada: React Query + key factory +
 * mensagemDeErro + sonner. Nada de Zustand aqui: o painel é read-mostly,
 * paginado no servidor, e cache por chave resolve melhor que estado global.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { chamarRpc, tabelaAdmin } from '@/lib/admin/api';
import { adminKeys } from './usePapeis';
import { mensagemDeErro } from '@/lib/errors';
import type { Periodo } from '@/lib/admin/periodo';
import type {
  Comissao,
  EventoReceita,
  MetricasVisaoGeral,
  PaginaAuditoria,
  PaginaUsuarios,
  Parceiro,
  ParceiroComResultados,
  PercentualParceiro,
  LinkParceiro,
  AtribuicaoParceiro,
} from '@/integrations/supabase/admin-types';

const POR_PAGINA = 25;

// ── Visão geral ───────────────────────────────────────────────────────────
export function useMetricas(periodo: Periodo) {
  return useQuery({
    queryKey: adminKeys.metricas(periodo.inicio, periodo.fim),
    queryFn: () =>
      chamarRpc<MetricasVisaoGeral>('admin_metricas_visao_geral', {
        p_inicio: periodo.inicio,
        p_fim: periodo.fim,
      }),
    retry: false,
  });
}

// ── Usuários ──────────────────────────────────────────────────────────────
export interface FiltrosUsuarios {
  busca?: string;
  status?: string;
  atividade?: string;
  parceiroId?: string;
  criadoDe?: string;
  criadoAte?: string;
  ordenar?: string;
  direcao?: 'asc' | 'desc';
  pagina: number;
}

export function useUsuarios(filtros: FiltrosUsuarios) {
  return useQuery({
    queryKey: adminKeys.usuarios(filtros),
    queryFn: () =>
      chamarRpc<PaginaUsuarios>('admin_listar_usuarios', {
        p_busca: filtros.busca || null,
        p_status: filtros.status || null,
        p_atividade: filtros.atividade || null,
        p_parceiro_id: filtros.parceiroId || null,
        p_criado_de: filtros.criadoDe || null,
        p_criado_ate: filtros.criadoAte || null,
        p_ordenar: filtros.ordenar || 'criado_em',
        p_direcao: filtros.direcao || 'desc',
        p_limite: POR_PAGINA,
        p_offset: (filtros.pagina - 1) * POR_PAGINA,
      }),
    retry: false,
    // Mantém a página anterior visível durante o refetch: sem isso, cada
    // tecla digitada na busca pisca a tabela inteira.
    placeholderData: (anterior) => anterior,
  });
}

export function useDetalheUsuario(corretorId: string | null) {
  return useQuery({
    queryKey: adminKeys.usuario(corretorId ?? ''),
    queryFn: () =>
      chamarRpc<Record<string, unknown>>('admin_detalhe_usuario', {
        p_corretor_id: corretorId,
      }),
    enabled: !!corretorId,
    retry: false,
  });
}

export function useDefinirStatusCorretor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: { corretorId: string; status: string; motivo: string }) =>
      chamarRpc<{ alterado: boolean }>('admin_definir_status_corretor', {
        p_corretor_id: dados.corretorId,
        p_status: dados.status,
        p_motivo: dados.motivo,
      }),
    onSuccess: (_r, dados) => {
      toast.success(
        dados.status === 'suspenso' ? 'Conta suspensa.' : 'Status da conta atualizado.',
      );
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível alterar o status.')),
  });
}

// ── Parceiros ─────────────────────────────────────────────────────────────
export interface FiltrosParceiros {
  busca?: string;
  status?: string;
  pagina: number;
}

export function useParceiros(filtros: FiltrosParceiros) {
  return useQuery({
    queryKey: adminKeys.parceiros(filtros),
    queryFn: () =>
      chamarRpc<{ itens: ParceiroComResultados[]; total: number }>('admin_listar_parceiros', {
        p_busca: filtros.busca || null,
        p_status: filtros.status || null,
        p_limite: POR_PAGINA,
        p_offset: (filtros.pagina - 1) * POR_PAGINA,
      }),
    retry: false,
    placeholderData: (anterior) => anterior,
  });
}

/**
 * Detalhe do parceiro. Lê as tabelas direto — elas têm policy `is_admin()` e o
 * volume por parceiro é pequeno, então não vale uma RPC dedicada.
 */
export function useParceiro(id: string | null) {
  return useQuery({
    queryKey: adminKeys.parceiro(id ?? ''),
    queryFn: async () => {
      const [parceiro, percentuais, links, atribuicoes] = await Promise.all([
        tabelaAdmin('parceiros').select('*').eq('id', id).single(),
        tabelaAdmin('parceiro_percentuais')
          .select('*')
          .eq('parceiro_id', id)
          .order('vigencia_inicio', { ascending: false }),
        tabelaAdmin('parceiro_links')
          .select('*')
          .eq('parceiro_id', id)
          .order('criado_em', { ascending: false }),
        tabelaAdmin('parceiro_atribuicoes')
          .select('*, corretores(nome, email)')
          .eq('parceiro_id', id)
          .order('criado_em', { ascending: false })
          .limit(100),
      ]);

      if (parceiro.error) throw parceiro.error;

      return {
        parceiro: parceiro.data as unknown as Parceiro,
        percentuais: (percentuais.data ?? []) as unknown as PercentualParceiro[],
        links: (links.data ?? []) as unknown as LinkParceiro[],
        atribuicoes: (atribuicoes.data ?? []) as unknown as AtribuicaoParceiro[],
      };
    },
    enabled: !!id,
    retry: false,
  });
}

export function useSalvarParceiro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dados: Partial<Parceiro> & { id?: string }) => {
      const { id, ...campos } = dados;
      const consulta = id
        ? tabelaAdmin('parceiros').update(campos).eq('id', id).select('id').single()
        : tabelaAdmin('parceiros').insert(campos).select('id').single();

      const { data, error } = await consulta;
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (_r, dados) => {
      toast.success(dados.id ? 'Parceiro atualizado.' : 'Parceiro criado.');
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível salvar o parceiro.')),
  });
}

export function useDefinirPercentual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: {
      parceiroId: string;
      percentual: number;
      baseCalculo: string;
      valorFixo?: number | null;
      vigenciaInicio?: string | null;
      motivo?: string;
    }) =>
      chamarRpc<{ id: string }>('admin_definir_percentual', {
        p_parceiro_id: dados.parceiroId,
        p_percentual: dados.percentual,
        p_base_calculo: dados.baseCalculo,
        p_valor_fixo: dados.valorFixo ?? null,
        p_vigencia_inicio: dados.vigenciaInicio ?? null,
        p_motivo: dados.motivo ?? null,
      }),
    onSuccess: () => {
      toast.success('Nova vigência criada. As comissões já geradas não mudam.');
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível alterar o percentual.')),
  });
}

export function useCriarLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dados: {
      parceiroId: string;
      slug: string;
      campanha?: string | null;
      principal?: boolean;
    }) => {
      const { data, error } = await tabelaAdmin('parceiro_links')
        .insert({
          parceiro_id: dados.parceiroId,
          slug: dados.slug,
          campanha: dados.campanha ?? null,
          principal: dados.principal ?? false,
        })
        .select('id, slug')
        .single();
      if (error) throw error;
      return data as { id: string; slug: string };
    },
    onSuccess: () => {
      toast.success('Link criado.');
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) =>
      toast.error(
        mensagemDeErro(
          e,
          'Não foi possível criar o link. Verifique se o identificador já está em uso.',
        ),
      ),
  });
}

export function useRevogarLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await tabelaAdmin('parceiro_links')
        .update({ ativo: false, revogado_em: new Date().toISOString() })
        .eq('id', linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Link revogado. Ele para de atribuir, mas o histórico permanece.');
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível revogar o link.')),
  });
}

// ── Comissões ─────────────────────────────────────────────────────────────
export interface FiltrosComissoes {
  parceiroId?: string;
  status?: string;
  de?: string;
  ate?: string;
  pagina: number;
}

export function useComissoes(filtros: FiltrosComissoes) {
  return useQuery({
    queryKey: adminKeys.comissoes(filtros),
    queryFn: () =>
      chamarRpc<{
        itens: Comissao[];
        total: number;
        totais: { valor_total: number; valor_base_total: number };
      }>('admin_listar_comissoes', {
        p_parceiro_id: filtros.parceiroId || null,
        p_status: filtros.status || null,
        p_de: filtros.de || null,
        p_ate: filtros.ate || null,
        p_limite: POR_PAGINA,
        p_offset: (filtros.pagina - 1) * POR_PAGINA,
      }),
    retry: false,
    placeholderData: (anterior) => anterior,
  });
}

export function useTransicionarComissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: { comissaoId: string; novoStatus: string; motivo?: string }) =>
      chamarRpc<{ status: string }>('admin_transicionar_comissao', {
        p_comissao_id: dados.comissaoId,
        p_novo_status: dados.novoStatus,
        p_motivo: dados.motivo ?? null,
      }),
    onSuccess: () => {
      toast.success('Comissão atualizada.');
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível atualizar a comissão.')),
  });
}

export function useRegistrarPagamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: {
      parceiroId: string;
      comissaoIds: string[];
      metodo?: string;
      referencia?: string;
      pagoEm?: string;
      observacoes?: string;
    }) =>
      chamarRpc<{ id: string; valor_total: number; comissoes: number }>(
        'admin_registrar_pagamento',
        {
          p_parceiro_id: dados.parceiroId,
          p_comissao_ids: dados.comissaoIds,
          p_metodo: dados.metodo ?? null,
          p_referencia: dados.referencia ?? null,
          p_pago_em: dados.pagoEm ?? null,
          p_observacoes: dados.observacoes ?? null,
        },
      ),
    onSuccess: (r) => {
      toast.success(`Pagamento registrado: ${r.comissoes} comissão(ões).`);
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível registrar o pagamento.')),
  });
}

// ── Receita ───────────────────────────────────────────────────────────────
export interface FiltrosReceita {
  corretorId?: string;
  status?: string;
  de?: string;
  ate?: string;
  pagina: number;
}

export function useReceita(filtros: FiltrosReceita) {
  return useQuery({
    queryKey: adminKeys.receita(filtros),
    queryFn: () =>
      chamarRpc<{ itens: EventoReceita[]; total: number }>('admin_listar_receita', {
        p_corretor_id: filtros.corretorId || null,
        p_status: filtros.status || null,
        p_de: filtros.de || null,
        p_ate: filtros.ate || null,
        p_limite: POR_PAGINA,
        p_offset: (filtros.pagina - 1) * POR_PAGINA,
      }),
    retry: false,
    placeholderData: (anterior) => anterior,
  });
}

export function useRegistrarReceita() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: {
      corretorId: string;
      valorBruto: number;
      confirmadoEm: string;
      tipo?: string;
      valorLiquido?: number | null;
      competencia?: string | null;
      motivo: string;
    }) =>
      chamarRpc<{ id: string }>('admin_registrar_receita', {
        p_corretor_id: dados.corretorId,
        p_valor_bruto: dados.valorBruto,
        p_confirmado_em: dados.confirmadoEm,
        p_tipo: dados.tipo ?? 'assinatura',
        p_valor_liquido: dados.valorLiquido ?? null,
        p_competencia: dados.competencia ?? null,
        p_motivo: dados.motivo,
      }),
    onSuccess: () => {
      toast.success('Receita registrada. A comissão do parceiro, se houver, foi gerada.');
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível registrar a receita.')),
  });
}

export function useEstornarReceita() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: { receitaId: string; motivo: string }) =>
      chamarRpc<{ id: string }>('admin_estornar_receita', {
        p_receita_id: dados.receitaId,
        p_motivo: dados.motivo,
      }),
    onSuccess: () => {
      toast.success('Receita estornada. As comissões em aberto foram estornadas junto.');
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível estornar a receita.')),
  });
}

// ── Auditoria ─────────────────────────────────────────────────────────────
export interface FiltrosAuditoria {
  entidade?: string;
  acao?: string;
  de?: string;
  ate?: string;
  pagina: number;
}

export function useAuditoria(filtros: FiltrosAuditoria) {
  return useQuery({
    queryKey: adminKeys.auditoria(filtros),
    queryFn: () =>
      chamarRpc<PaginaAuditoria>('admin_listar_auditoria', {
        p_entidade: filtros.entidade || null,
        p_acao: filtros.acao || null,
        p_de: filtros.de || null,
        p_ate: filtros.ate || null,
        p_limite: 50,
        p_offset: (filtros.pagina - 1) * 50,
      }),
    retry: false,
    placeholderData: (anterior) => anterior,
  });
}

export const ITENS_POR_PAGINA = POR_PAGINA;
