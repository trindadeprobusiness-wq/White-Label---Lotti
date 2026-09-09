/**
 * Acesso a dados da operação do SaaS: assinaturas, pagamentos, cancelamentos,
 * repasses em lote, integrações e configuração do programa.
 *
 * Separado de `useAdminDados.ts` de propósito. Aquele arquivo cobre o back
 * office de parceiros e receita e já passa de 470 linhas; misturar os dois
 * módulos tornaria difícil ver qual consulta pertence a que assunto. As
 * convenções são as mesmas: React Query, `adminKeys`, `mensagemDeErro` e
 * sonner.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { chamarRpc } from '@/lib/admin/api';
import { adminKeys } from './usePapeis';
import { ITENS_POR_PAGINA } from './useAdminDados';
import { mensagemDeErro } from '@/lib/errors';
import type { Periodo } from '@/lib/admin/periodo';
import type {
  MetricasSaas,
  PaginaAssinaturas,
  PaginaPagamentos,
  PaginaCancelamentos,
  MetricasCancelamento,
  ElegiveisRepasse,
  PaginaLotes,
  DetalheLote,
  StatusIntegracoes,
  ConfigAdmin,
} from '@/integrations/supabase/admin-types';

// ── Visão geral do SaaS ───────────────────────────────────────────────────
export function useMetricasSaas(periodo: Periodo) {
  return useQuery({
    queryKey: adminKeys.metricasSaas(periodo.inicio, periodo.fim),
    queryFn: () =>
      chamarRpc<MetricasSaas>('admin_metricas_saas', {
        p_inicio: periodo.inicio,
        p_fim: periodo.fim,
      }),
    retry: false,
  });
}

// ── Assinaturas ───────────────────────────────────────────────────────────
export interface FiltrosAssinaturas {
  busca?: string;
  status?: string;
  plano?: string;
  ciclo?: string;
  pagina: number;
}

export function useAssinaturas(filtros: FiltrosAssinaturas) {
  return useQuery({
    queryKey: adminKeys.assinaturas(filtros),
    queryFn: () =>
      chamarRpc<PaginaAssinaturas>('admin_listar_assinaturas', {
        p_busca: filtros.busca || null,
        p_status: filtros.status || null,
        p_plano: filtros.plano || null,
        p_ciclo: filtros.ciclo || null,
        p_pagina: filtros.pagina,
        p_por_pagina: ITENS_POR_PAGINA,
      }),
    retry: false,
  });
}

// ── Pagamentos ────────────────────────────────────────────────────────────
export interface FiltrosPagamentos {
  busca?: string;
  status?: string;
  metodo?: string;
  plano?: string;
  de?: string;
  ate?: string;
  pagina: number;
}

export function usePagamentos(filtros: FiltrosPagamentos) {
  return useQuery({
    queryKey: adminKeys.pagamentos(filtros),
    queryFn: () =>
      chamarRpc<PaginaPagamentos>('admin_listar_pagamentos', {
        p_busca: filtros.busca || null,
        p_status: filtros.status || null,
        p_metodo: filtros.metodo || null,
        p_plano: filtros.plano || null,
        p_inicio: filtros.de || null,
        p_fim: filtros.ate || null,
        p_pagina: filtros.pagina,
        p_por_pagina: ITENS_POR_PAGINA,
      }),
    retry: false,
  });
}

// ── Cancelamentos ─────────────────────────────────────────────────────────
export interface FiltrosCancelamentos {
  motivo?: string;
  origem?: string;
  plano?: string;
  de?: string;
  ate?: string;
  pagina: number;
}

export function useCancelamentos(filtros: FiltrosCancelamentos) {
  return useQuery({
    queryKey: adminKeys.cancelamentos(filtros),
    queryFn: () =>
      chamarRpc<PaginaCancelamentos>('admin_listar_cancelamentos', {
        p_motivo: filtros.motivo || null,
        p_origem: filtros.origem || null,
        p_plano: filtros.plano || null,
        p_inicio: filtros.de || null,
        p_fim: filtros.ate || null,
        p_pagina: filtros.pagina,
        p_por_pagina: ITENS_POR_PAGINA,
      }),
    retry: false,
  });
}

export function useMetricasCancelamento(periodo: Periodo) {
  return useQuery({
    queryKey: adminKeys.metricasCancelamento(periodo.inicio, periodo.fim),
    queryFn: () =>
      chamarRpc<MetricasCancelamento>('admin_metricas_cancelamento', {
        p_inicio: periodo.inicio,
        p_fim: periodo.fim,
      }),
    retry: false,
  });
}

export function useRegistrarCancelamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: {
      motivo: string;
      corretorId?: string | null;
      contatoNome?: string;
      contatoEmail?: string;
      contatoTelefone?: string;
      planoAnterior?: string;
      comentario?: string;
      origem?: string;
      data?: string;
    }) =>
      chamarRpc<{ id: string }>('admin_registrar_cancelamento', {
        p_motivo: dados.motivo,
        p_corretor_id: dados.corretorId ?? null,
        p_contato_nome: dados.contatoNome ?? null,
        p_contato_email: dados.contatoEmail ?? null,
        p_contato_telefone: dados.contatoTelefone ?? null,
        p_plano_anterior: dados.planoAnterior ?? null,
        p_comentario: dados.comentario ?? null,
        p_origem: dados.origem ?? 'outro',
        p_data: dados.data ?? null,
      }),
    onSuccess: () => {
      toast.success('Cancelamento registrado.');
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) =>
      toast.error(mensagemDeErro(e, 'Não foi possível registrar o cancelamento.')),
  });
}

// ── Repasses ──────────────────────────────────────────────────────────────
export function useElegiveisRepasse(saldoMinimo: number | null) {
  return useQuery({
    queryKey: adminKeys.elegiveisRepasse(saldoMinimo),
    queryFn: () =>
      chamarRpc<ElegiveisRepasse>('admin_parceiros_elegiveis_repasse', {
        p_saldo_minimo: saldoMinimo,
      }),
    retry: false,
  });
}

export function useLotes(filtros: { status?: string; pagina: number }) {
  return useQuery({
    queryKey: adminKeys.lotes(filtros),
    queryFn: () =>
      chamarRpc<PaginaLotes>('admin_listar_lotes', {
        p_status: filtros.status || null,
        p_pagina: filtros.pagina,
        p_por_pagina: ITENS_POR_PAGINA,
      }),
    retry: false,
  });
}

export function useLote(id: string | null) {
  return useQuery({
    queryKey: adminKeys.lote(id ?? ''),
    queryFn: () => chamarRpc<DetalheLote>('admin_detalhe_lote', { p_lote_id: id }),
    enabled: !!id,
    retry: false,
  });
}

export function useGerarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: {
      parceiroIds: string[];
      saldoMinimo?: number | null;
      observacoes?: string;
    }) =>
      chamarRpc<{
        id: string;
        referencia: string;
        valor_total: number;
        total_comissoes: number;
        total_parceiros: number;
      }>('admin_gerar_lote_repasse', {
        p_parceiro_ids: dados.parceiroIds,
        p_saldo_minimo: dados.saldoMinimo ?? null,
        p_observacoes: dados.observacoes ?? null,
      }),
    onSuccess: (r) => {
      toast.success(`Lote ${r.referencia} gerado com ${r.total_parceiros} parceiro(s).`);
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível gerar o lote.')),
  });
}

export function useMarcarLoteExportado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loteId: string) =>
      chamarRpc<{ status: string }>('admin_marcar_lote_exportado', { p_lote_id: loteId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    // Sem toast de erro de propósito: o que importa para o operador é que o
    // CSV baixou. Falhar em carimbar o lote como exportado não pode dar a
    // impressão de que o arquivo não saiu — o estado é corrigível na tela.
    onError: () => undefined,
  });
}

export function useMarcarLotePago() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: {
      loteId: string;
      pagoEm: string;
      referencia: string;
      comprovanteUrl?: string;
    }) =>
      chamarRpc<{ status: string; pagamentos: number }>('admin_marcar_lote_pago', {
        p_lote_id: dados.loteId,
        p_pago_em: dados.pagoEm,
        p_referencia: dados.referencia,
        p_comprovante_url: dados.comprovanteUrl ?? null,
      }),
    onSuccess: (r) => {
      toast.success(`Lote pago: ${r.pagamentos} repasse(s) registrado(s).`);
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) =>
      toast.error(mensagemDeErro(e, 'Não foi possível marcar o lote como pago.')),
  });
}

export function useCancelarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: { loteId: string; motivo: string }) =>
      chamarRpc<{ status: string; comissoes_liberadas: number }>('admin_cancelar_lote', {
        p_lote_id: dados.loteId,
        p_motivo: dados.motivo,
      }),
    onSuccess: (r) => {
      toast.success(`Lote cancelado. ${r.comissoes_liberadas} comissão(ões) liberadas.`);
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível cancelar o lote.')),
  });
}

// ── Integrações e configuração ────────────────────────────────────────────
export function useStatusIntegracoes() {
  return useQuery({
    queryKey: adminKeys.integracoes(),
    queryFn: () => chamarRpc<StatusIntegracoes>('admin_status_integracoes'),
    retry: false,
  });
}

export function useConfigAdmin() {
  return useQuery({
    queryKey: adminKeys.config(),
    queryFn: () => chamarRpc<ConfigAdmin[]>('admin_listar_config'),
    retry: false,
  });
}

export function useSalvarConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: { chave: string; valor: unknown }) =>
      chamarRpc<{ chave: string }>('admin_salvar_config', {
        p_chave: dados.chave,
        p_valor: dados.valor,
      }),
    onSuccess: () => {
      toast.success('Configuração salva.');
      void qc.invalidateQueries({ queryKey: adminKeys.config() });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível salvar a configuração.')),
  });
}
