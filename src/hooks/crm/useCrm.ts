import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { mensagemDeErro } from '@/lib/errors';
import { normalizarLead } from '@/lib/crm/pipeline';
import { paraRegistro } from '@/lib/crm/historico';
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

// ── Modo de operação ──────────────────────────────────────────────────────

/**
 * O CRM funciona em dois modos, e escolhe sozinho:
 *
 * - COMPLETO: as tabelas crm_* existem → negócio separado do contato, etapas
 *   configuráveis, tarefas com prazo.
 * - LEGADO: as tabelas ainda não foram criadas → o pipeline roda sobre
 *   `clientes.status_funil` e as tarefas sobre `alertas`, que já existem.
 *
 * Sem isso a aba abria vazia até alguém aplicar a migration à mão — foi
 * exatamente o que aconteceu: a funcionalidade existia e ninguém conseguia ver.
 * Assim ela é útil desde o primeiro segundo e fica mais rica depois.
 */
/** Linha crua de clientes no modo legado (com o imóvel de interesse embutido). */
type ClienteBruto = {
  id: string; nome: string; telefone: string | null; status_funil: string; created_at: string;
  // O PostgREST devolve relacao aninhada como array na inferencia do cliente sem
  // tipos gerados, mesmo quando a relacao e para-um. Dai o helper primeiro().
  cliente_imovel?: { imovel_id: string; imoveis?: { titulo: string; valor: number }[] }[];
};

/** Primeiro item de uma relacao aninhada (array ou objeto). */
const primeiro = <T,>(v: T | T[] | null | undefined): T | undefined =>
  Array.isArray(v) ? v[0] : (v ?? undefined);

/** Linha crua de alertas, usada como tarefa no modo legado. */
type AlertaBruto = {
  id: string; mensagem: string; lido: boolean; created_at: string;
  cliente_id: string | null; clientes?: { nome?: string }[];
};

export type ModoCrm = 'completo' | 'legado';

/** Etapas sintéticas equivalentes ao enum status_funil, para o modo legado. */
const ETAPAS_LEGADO: CrmEtapa[] = [
  { id: 'QUALIFICACAO', corretor_id: '', nome: 'Qualificação', ordem: 1, cor: 'blue', tipo: 'ABERTA', ativo: true },
  { id: 'VISITA_PROPOSTA', corretor_id: '', nome: 'Visita / Proposta', ordem: 2, cor: 'amber', tipo: 'ABERTA', ativo: true },
  { id: 'DOCUMENTACAO', corretor_id: '', nome: 'Documentação', ordem: 3, cor: 'orange', tipo: 'ABERTA', ativo: true },
  { id: 'FECHADO_GANHO', corretor_id: '', nome: 'Fechado — ganho', ordem: 4, cor: 'green', tipo: 'GANHO', ativo: true },
  { id: 'FECHADO_PERDIDO', corretor_id: '', nome: 'Fechado — perdido', ordem: 5, cor: 'red', tipo: 'PERDIDO', ativo: true },
];

export function useModoCrm() {
  return useQuery({
    queryKey: [...crmKeys.todos, 'modo'] as const,
    staleTime: Infinity, // o schema não muda durante a sessão
    queryFn: async (): Promise<ModoCrm> => {
      const { error } = await db().from('crm_etapas').select('id').limit(1);
      // 42P01 = relation does not exist. Qualquer erro aqui significa "ainda
      // não dá para usar o modo completo" — degrada em vez de quebrar a tela.
      return error ? 'legado' : 'completo';
    },
  });
}

// ── Leitura ───────────────────────────────────────────────────────────────

export function useEtapas() {
  const { data: modo } = useModoCrm();
  return useQuery({
    queryKey: [...crmKeys.etapas(), modo] as const,
    enabled: !!modo,
    queryFn: async (): Promise<CrmEtapa[]> => {
      if (modo === 'legado') return ETAPAS_LEGADO;
      const { data, error } = await db()
        .from('crm_etapas').select('*').eq('ativo', true).order('ordem');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOportunidades() {
  const { data: modo } = useModoCrm();
  return useQuery({
    queryKey: [...crmKeys.oportunidades(), modo] as const,
    enabled: !!modo,
    queryFn: async (): Promise<CrmOportunidade[]> => {
      if (modo === 'legado') {
        // Cada cliente vira um card, com a etapa vindo do status_funil e o valor
        // do primeiro imóvel de interesse — a mesma leitura que o funil já fazia.
        const { data, error } = await db()
          .from('clientes')
          .select('id, nome, telefone, status_funil, created_at, cliente_imovel(imovel_id, imoveis(titulo, valor))')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return (data ?? []).map((c: ClienteBruto, i: number) => {
          const vinculo = primeiro(c.cliente_imovel);
          const imovel = primeiro(vinculo?.imoveis);
          return {
            id: c.id, corretor_id: '', cliente_id: c.id,
            imovel_id: vinculo?.imovel_id ?? null,
            etapa_id: c.status_funil,
            titulo: c.nome,
            valor_estimado: Number(imovel?.valor ?? 0),
            probabilidade: 0, data_prevista_fechamento: null, motivo_perda: null,
            origem: null, ordem: i, observacoes: null, fechada_em: null,
            created_at: c.created_at, updated_at: c.created_at,
            clientes: { nome: c.nome, telefone: c.telefone },
            imoveis: imovel ? { titulo: imovel.titulo } : undefined,
          } as CrmOportunidade;
        });
      }

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
  const { data: modo } = useModoCrm();
  return useQuery({
    queryKey: [...crmKeys.tarefas(), modo] as const,
    enabled: !!modo,
    queryFn: async (): Promise<CrmTarefa[]> => {
      if (modo === 'legado') {
        // `alertas` já é a lista de "o que precisa de ação" do sistema.
        const { data, error } = await db()
          .from('alertas')
          .select('id, mensagem, lido, created_at, cliente_id, clientes(nome)')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return (data ?? []).map((a: AlertaBruto) => ({
          id: a.id, corretor_id: '', oportunidade_id: null, cliente_id: a.cliente_id,
          titulo: a.mensagem, descricao: null, tipo: 'OUTRO',
          data_prevista: a.created_at, concluida: !!a.lido,
          concluida_em: null, created_at: a.created_at,
          clientes: primeiro(a.clientes),
        }) as CrmTarefa);
      }

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
  const { data: modo } = useModoCrm();
  return useMutation({
    mutationFn: async (args: {
      id: string; etapaId: string; ordem: number; updatedAt: string;
    }) => {
      // No modo legado o "negócio" é o próprio cliente e a etapa é o status_funil —
      // mover o card grava exatamente o que o funil clássico sempre gravou.
      if (modo === 'legado') {
        const { error } = await db()
          .from('clientes').update({ status_funil: args.etapaId }).eq('id', args.id);
        if (error) throw error;
        return { id: args.id };
      }

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

/**
 * Registra no histórico do cliente que uma mensagem foi enviada por WhatsApp.
 *
 * O envio em si acontece fora do sistema (o corretor confere e aperta enviar no
 * WhatsApp), então isto NÃO é confirmação de entrega — é registro de que o
 * contato foi feito, que é o que alimenta "último contato" e a timeline.
 *
 * `direcao: OUT` porque saiu do corretor — é o que permite renderizar como
 * conversa depois, quando mensagens recebidas (IN) começarem a chegar.
 */
export function useRegistrarContatoWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { clienteId: string; mensagem: string }) => {
      const { error } = await db().from('historico_contatos').insert(
        paraRegistro({
          clienteId: args.clienteId,
          tipo: 'WHATSAPP',
          texto: args.mensagem.slice(0, 500),
          direcao: 'OUT',
          metadata: { via: 'wa.me' },
        }),
      );
      if (error) throw error;
      await db().from('clientes')
        .update({ ultimo_contato: new Date().toISOString() })
        .eq('id', args.clienteId);
    },
    onSuccess: () => {
      toast.success('Contato registrado no histórico.');
      qc.invalidateQueries({ queryKey: crmKeys.oportunidades() });
    },
    // Falhar aqui não pode atrapalhar: a mensagem já foi aberta no WhatsApp.
    onError: (e) => console.error('Não foi possível registrar o contato:', e),
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
