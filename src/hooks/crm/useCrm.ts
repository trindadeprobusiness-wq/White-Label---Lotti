import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { mensagemDeErro } from '@/lib/errors';
import { normalizarLead } from '@/lib/crm/pipeline';
import type { CrmEtapa, CrmOportunidade, CrmTarefa } from '@/lib/crm/tipos';

/**
 * Camada de dados do CRM (React Query).
 *
 * O projeto não tinha convenção de query key — as chaves eram strings inline e
 * uma delas ("rental-bills") já não casa com query nenhuma, então invalidar não
 * faz nada. Aqui a factory abaixo é a única fonte das chaves, para o mesmo erro
 * não nascer de novo.
 *
 * As tabelas do CRM ainda não estão no types.ts gerado, daí os casts — mesmo
 * padrão já usado no projeto para fachadas e faturas.
 */
export const crmKeys = {
  todos: ['crm'] as const,
  etapas: () => [...crmKeys.todos, 'etapas'] as const,
  oportunidades: () => [...crmKeys.todos, 'oportunidades'] as const,
  tarefas: () => [...crmKeys.todos, 'tarefas'] as const,
  leads: () => [...crmKeys.todos, 'leads'] as const,
};

/**
 * As tabelas do CRM ainda não estão no `types.ts` gerado (que cobre 11 de ~31
 * tabelas do projeto). Em vez de espalhar `as any`, o acesso passa por um
 * cliente sem o genérico de schema — mesmo efeito, sem apagar tipo no resto.
 * Some quando os tipos forem regerados.
 */
const db = () => supabase as unknown as SupabaseClient;

async function corretorId(): Promise<string> {
  const { data, error } = await supabase.rpc('get_corretor_id');
  if (error || !data) throw new Error('Não foi possível identificar o corretor.');
  return data as string;
}

// ── Leitura ───────────────────────────────────────────────────────────────

export function useEtapas() {
  return useQuery({
    queryKey: crmKeys.etapas(),
    queryFn: async (): Promise<CrmEtapa[]> => {
      const { data, error } = await db()
        .from('crm_etapas').select('*').eq('ativo', true).order('ordem');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOportunidades() {
  return useQuery({
    queryKey: crmKeys.oportunidades(),
    queryFn: async (): Promise<CrmOportunidade[]> => {
      const { data, error } = await db()
        .from('crm_oportunidades')
        .select('*, clientes(nome, telefone), imoveis(titulo)')
        .order('ordem');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTarefas() {
  return useQuery({
    queryKey: crmKeys.tarefas(),
    queryFn: async (): Promise<CrmTarefa[]> => {
      const { data, error } = await db()
        .from('crm_tarefas')
        .select('*, clientes(nome)')
        .order('data_prevista', { nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Leads capturados nas fachadas que ainda não viraram cliente. */
export function useLeadsPendentes() {
  return useQuery({
    queryKey: crmKeys.leads(),
    queryFn: async () => {
      const { data, error } = await db()
        .from('fachada_leads')
        .select('id, nome, telefone, email, created_at, convertido, fachada_id')
        .eq('convertido', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Mutações ──────────────────────────────────────────────────────────────

/**
 * Move o card. O `updated_at` conhecido entra no WHERE: se ninguém alterou o
 * registro nesse meio-tempo o update casa; se alguém moveu antes (outra aba,
 * outro dispositivo), zero linhas voltam e avisamos em vez de sobrescrever.
 */
export function useMoverOportunidade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string; etapaId: string; ordem: number; updatedAt: string;
    }) => {
      const { data, error } = await db()
        .from('crm_oportunidades')
        .update({ etapa_id: args.etapaId, ordem: args.ordem })
        .eq('id', args.id)
        .eq('updated_at', args.updatedAt)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('CONFLITO');
      return data[0];
    },
    onError: (e: unknown) => {
      if (e instanceof Error && e.message === 'CONFLITO') {
        toast.warning('Este negócio foi movido em outro lugar. Recarreguei para você ver a posição atual.');
      } else {
        toast.error(mensagemDeErro(e, 'Não foi possível mover o negócio.'));
      }
      qc.invalidateQueries({ queryKey: crmKeys.oportunidades() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.oportunidades() }),
  });
}

export function useCriarOportunidade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nova: Partial<CrmOportunidade>) => {
      const { data, error } = await db()
        .from('crm_oportunidades')
        .insert({ ...nova, corretor_id: await corretorId() })
        .select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Oportunidade criada.');
      qc.invalidateQueries({ queryKey: crmKeys.oportunidades() });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível criar a oportunidade.')),
  });
}

export function useConcluirTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; concluida: boolean }) => {
      const { error } = await db().from('crm_tarefas').update({
        concluida: args.concluida,
        concluida_em: args.concluida ? new Date().toISOString() : null,
      }).eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.tarefas() }),
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível atualizar a tarefa.')),
  });
}

export function useCriarTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nova: Partial<CrmTarefa>) => {
      const { error } = await db()
        .from('crm_tarefas').insert({ ...nova, corretor_id: await corretorId() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Tarefa criada.');
      qc.invalidateQueries({ queryKey: crmKeys.tarefas() });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível criar a tarefa.')),
  });
}

/**
 * Converte um lead da fachada em cliente + oportunidade. É a lacuna que existia:
 * `fachada_leads.convertido` só era exibido como badge e `cliente_id` nunca era
 * preenchido — os leads entravam e ficavam parados.
 *
 * `clienteExistente` vem da tela quando o usuário confirmou que é a mesma
 * pessoa, e aí nenhum cliente novo é criado.
 */
export function useConverterLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      lead: { id: string; nome: string; telefone: string; email?: string | null };
      etapaId: string;
      clienteExistente?: string | null;
    }) => {
      const corretor = await corretorId();
      let clienteId = args.clienteExistente ?? null;

      if (!clienteId) {
        const limpo = normalizarLead(args.lead);
        const { data, error } = await db().from('clientes').insert({
          nome: limpo.nome,
          telefone: limpo.telefone,
          email: limpo.email,
          tipo_interesse: 'COMPRA',
          status_funil: 'QUALIFICACAO',
          observacoes: 'Convertido de lead da fachada.',
          corretor_id: corretor,
        }).select('id').single();
        if (error) throw error;
        clienteId = data.id;
      }

      const { error: erroOp } = await db().from('crm_oportunidades').insert({
        corretor_id: corretor,
        cliente_id: clienteId,
        etapa_id: args.etapaId,
        titulo: args.lead.nome,
        origem: 'fachada',
      });
      if (erroOp) throw erroOp;

      const { error: erroLead } = await db().from('fachada_leads')
        .update({ convertido: true, cliente_id: clienteId })
        .eq('id', args.lead.id);
      if (erroLead) throw erroLead;

      return clienteId;
    },
    onSuccess: () => {
      toast.success('Lead convertido em cliente e oportunidade.');
      qc.invalidateQueries({ queryKey: crmKeys.leads() });
      qc.invalidateQueries({ queryKey: crmKeys.oportunidades() });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível converter o lead.')),
  });
}
