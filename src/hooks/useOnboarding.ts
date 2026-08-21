import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  normalizarContextoOnboarding,
  type ContextoOnboarding,
  type ContextoOnboardingBruto,
} from '@/lib/onboarding/contexto';

const client = supabase as unknown as SupabaseClient;

export const onboardingKeys = {
  todos: ['onboarding'] as const,
  contexto: () => [...onboardingKeys.todos, 'contexto'] as const,
};

function recursoAindaNaoAplicado(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? '')
    || /get_onboarding_contexto|onboarding_profiles|schema cache/i.test(error.message ?? '');
}

async function buscarContexto(): Promise<ContextoOnboarding | null> {
  const { data, error } = await client.rpc('get_onboarding_contexto');
  if (error) {
    // A migration pode ainda estar na fila do SQL Editor. O onboarding nunca
    // bloqueia o produto nesse intervalo.
    if (recursoAindaNaoAplicado(error)) return null;
    throw error;
  }
  if (!data || typeof data !== 'object') return null;
  return normalizarContextoOnboarding(data as ContextoOnboardingBruto);
}

export interface SalvarOnboardingInput {
  profile?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  stepKey?: string;
  stepStatus?: 'iniciado' | 'concluido' | 'pulado' | 'erro';
}

export type EventoOnboarding =
  | 'signup_completed'
  | 'onboarding_started'
  | 'persona_selected'
  | 'organization_created'
  | 'profile_completed'
  | 'first_property_created'
  | 'first_client_created'
  | 'first_deal_created'
  | 'first_task_created'
  | 'calendar_connected'
  | 'team_member_invited'
  | 'ai_first_used'
  | 'onboarding_step_skipped'
  | 'onboarding_completed'
  | 'onboarding_abandoned'
  | 'first_value_reached';

export interface AcaoOnboardingInput {
  action: 'first_property' | 'first_client' | 'first_deal' | 'first_task'
    | 'sample_property' | 'sample_client' | 'sample_deal' | 'sample_task' | 'remove_samples';
  payload?: Record<string, unknown>;
}

export function useOnboarding() {
  const queryClient = useQueryClient();
  const contexto = useQuery({
    queryKey: onboardingKeys.contexto(),
    queryFn: buscarContexto,
    retry: false,
    staleTime: 30_000,
  });

  const invalidar = async () => {
    await queryClient.invalidateQueries({ queryKey: onboardingKeys.todos });
  };

  const salvar = useMutation({
    mutationFn: async (input: SalvarOnboardingInput) => {
      const { data, error } = await client.rpc('salvar_onboarding', {
        p_profile: input.profile ?? {},
        p_progress: input.progress ?? {},
        p_step_key: input.stepKey ?? null,
        p_step_status: input.stepStatus ?? null,
      });
      if (error) throw error;
      return data && typeof data === 'object'
        ? normalizarContextoOnboarding(data as ContextoOnboardingBruto)
        : null;
    },
    onSuccess: async (data) => {
      if (data) queryClient.setQueryData(onboardingKeys.contexto(), data);
      else await invalidar();
    },
  });

  const executarAcao = useMutation({
    mutationFn: async ({ action, payload }: AcaoOnboardingInput) => {
      const { data, error } = await client.rpc('onboarding_executar_acao', {
        p_action: action,
        p_payload: payload ?? {},
      });
      if (error) throw error;
      return data as { id?: string; reused?: boolean; removed?: boolean };
    },
    onSuccess: invalidar,
  });

  const atualizarPerfilProfissional = useMutation({
    mutationFn: async (campos: Record<string, unknown>) => {
      const permitidos = [
        'nome', 'telefone', 'foto_url', 'cidade', 'estado', 'tipo_atuacao', 'creci',
        'regioes_atendidas', 'especialidade', 'fuso_horario', 'creci_status',
      ];
      const seguros = Object.fromEntries(Object.entries(campos).filter(([chave]) => permitidos.includes(chave)));
      const { error } = await client.from('corretores').update(seguros).eq('user_id', (await client.auth.getUser()).data.user?.id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const atualizarOrganizacao = useMutation({
    mutationFn: async ({ id, ...campos }: Record<string, unknown> & { id: string }) => {
      const mapa: Record<string, string> = {
        nome: 'name', nome_comercial: 'trade_name', cnpj: 'cnpj', telefone: 'phone',
        email: 'email', cidade: 'city', estado: 'state', logo_url: 'logo_url',
        tamanho_equipe: 'team_size', tipo_operacao: 'operation_types',
        tipo_organizacao: 'organization_type', fuso_horario: 'timezone',
      };
      const seguros = Object.fromEntries(
        Object.entries(campos)
          .filter(([chave]) => Boolean(mapa[chave]))
          .map(([chave, valor]) => [mapa[chave], valor]),
      );
      const { error } = await client.from('routine_organizations').update(seguros).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const registrarEvento = async (
    eventName: EventoOnboarding,
    stepKey?: string,
    metadata?: Record<string, string | number | boolean | null>,
  ) => {
    const { error } = await client.rpc('registrar_onboarding_evento', {
      p_event_name: eventName,
      p_step_key: stepKey ?? null,
      p_source: 'onboarding',
      p_metadata: metadata ?? {},
    });
    if (error && !recursoAindaNaoAplicado(error)) throw error;
  };

  const criarConvite = useMutation({
    mutationFn: async ({ email, papel }: { email: string; papel: string }) => {
      const { data, error } = await client.rpc('criar_convite_organizacao', {
        p_email: email,
        p_papel: papel,
      });
      if (error) throw error;
      return data as { id: string; token: string; expires_in_days: number };
    },
    onSuccess: invalidar,
  });

  const aceitarConvite = useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await client.rpc('aceitar_convite_organizacao', { p_token: token });
      if (error) throw error;
      return data as { organization_id: string; papel: string };
    },
    onSuccess: invalidar,
  });

  const salvarChecklist = useMutation({
    mutationFn: async ({ minimized, dismissed }: { minimized?: boolean; dismissed?: boolean }) => {
      const profileId = contexto.data?.profileId;
      if (!profileId) return;
      const campos: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
      if (typeof minimized === 'boolean') campos.minimized = minimized;
      if (dismissed) campos.dismissed_at = new Date().toISOString();
      const { error } = await client.from('onboarding_checklist').update(campos).eq('profile_id', profileId);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const salvarTour = async (tourKey: string, status: 'concluido' | 'dispensado', currentStep = 0) => {
    const { error } = await client.rpc('salvar_onboarding_tour', {
      p_tour_key: tourKey,
      p_status: status,
      p_current_step: currentStep,
    });
    if (error) throw error;
    await invalidar();
  };

  return {
    contexto: contexto.data ?? null,
    carregando: contexto.isLoading,
    erro: contexto.error,
    disponivel: contexto.data !== null && contexto.data !== undefined,
    recarregar: contexto.refetch,
    salvar,
    executarAcao,
    atualizarPerfilProfissional,
    atualizarOrganizacao,
    registrarEvento,
    criarConvite,
    aceitarConvite,
    salvarChecklist,
    salvarTour,
  };
}
