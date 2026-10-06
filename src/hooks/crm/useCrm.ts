import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { mensagemDeErro } from '@/lib/errors';
import { apiDisponivel } from '@/lib/api';
import {
  CHAVES_NOVA_OPORTUNIDADE,
  CHAVES_NOVA_TAREFA,
  atualizarClienteApi,
  buscarCandidatosApi,
  concluirTarefaApi,
  converterLeadApi,
  criarOportunidadeApi,
  criarTarefaApi,
  excluirOportunidadesApi,
  listarEtapasApi,
  listarOportunidadesApi,
  listarTarefasApi,
  moverOportunidadeApi,
  registrarHistoricoApi,
} from '@/lib/api/crm';
import { listarLeadsPendentesApi } from '@/lib/api/fachadas';
import { comoResultado, escolher } from '@/lib/api/http';
import { normalizarLead } from '@/lib/crm/pipeline';
import { paraRegistro } from '@/lib/crm/historico';
import { candidatosValidos, codigoDoErro, type CandidatoCliente } from '@/lib/crm/duplicidade';
import { useCRMStore } from '@/stores/crmStore';
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
  candidatos: (telefone: string, email: string, cpf: string) =>
    [...crmKeys.todos, 'candidatos', telefone, email, cpf] as const,
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
  is_sample_data?: boolean;
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
export const ETAPAS_LEGADO: CrmEtapa[] = [
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
      // Com a API as tabelas crm_* existem (baseline e Railway): sem sonda, um
      // erro passageiro não prende a sessão inteira no modo legado.
      if (apiDisponivel()) return 'completo';
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
      if (apiDisponivel()) return await listarEtapasApi();
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
          .select('id, nome, telefone, status_funil, created_at, is_sample_data, cliente_imovel(imovel_id, imoveis(titulo, valor))')
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
            is_sample_data: c.is_sample_data,
            clientes: { nome: c.nome, telefone: c.telefone },
            imoveis: imovel ? { titulo: imovel.titulo } : undefined,
          } as CrmOportunidade;
        });
      }

      if (apiDisponivel()) return await listarOportunidadesApi();
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

      if (apiDisponivel()) return await listarTarefasApi();
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
      // Com a API ligada: F5 das fachadas filtrado por convertido=false, mesma ordem.
      if (apiDisponivel()) return await listarLeadsPendentesApi();
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

/**
 * Clientes da conta que podem ser a mesma pessoa: mesmo telefone (em qualquer
 * grafia, pela chave do banco), mesmo CPF/CNPJ ou mesmo e-mail. A busca é no
 * servidor porque a lista em memória do CRM pode estar desatualizada e porque
 * a regra do telefone (9º dígito, código do país) é a do banco.
 *
 * Só consulta com dado utilizável, para não disparar uma chamada por tecla.
 */
export function useClientesParecidos(
  dados: { telefone?: string | null; email?: string | null; cpf?: string | null },
  habilitado = true,
) {
  const telefone = (dados.telefone ?? '').replace(/\D/g, '');
  const email = (dados.email ?? '').trim().toLowerCase();
  const cpf = (dados.cpf ?? '').replace(/\D/g, '');
  const chave = {
    telefone: telefone.length >= 10 ? telefone : '',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
    cpf: cpf.length === 11 || cpf.length === 14 ? cpf : '',
  };
  return useQuery({
    queryKey: crmKeys.candidatos(chave.telefone, chave.email, chave.cpf),
    enabled: habilitado && !!(chave.telefone || chave.email || chave.cpf),
    queryFn: async (): Promise<CandidatoCliente[]> => {
      if (apiDisponivel()) {
        return candidatosValidos(await buscarCandidatosApi({
          telefone: chave.telefone || null, email: chave.email || null, cpf: chave.cpf || null,
        }));
      }
      const { data, error } = await db().rpc('crm_clientes_por_telefone', {
        p_telefone: chave.telefone || null, p_email: chave.email || null, p_cpf: chave.cpf || null,
      });
      if (error) throw error;
      return candidatosValidos(data);
    },
  });
}

// ── Mutações ──────────────────────────────────────────────────────────────

/**
 * Move o card. O `updated_at` conhecido entra no WHERE: se ninguém alterou o
 * registro nesse meio-tempo o update casa; se alguém moveu antes (outra aba,
 * outro dispositivo), zero linhas voltam e avisamos em vez de sobrescrever.
 */
/**
 * Excluir negócios em lote. O botão existia desabilitado desde sempre: a tela
 * oferecia a ação e o clique não ia a lugar nenhum.
 *
 * No modo legado o "negócio" é o próprio cliente, e apagar o cliente a partir
 * do funil seria destrutivo demais para o que o botão promete — ali a exclusão
 * é recusada e o corretor é mandado para a tela de Clientes.
 */
export function useExcluirOportunidades() {
  const qc = useQueryClient();
  const { data: modo } = useModoCrm();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (modo === 'legado') throw new Error('exclusao_no_funil_legado');
      if (apiDisponivel()) {
        // A seleção só tem negócios da lista carregada (até 1000), o mesmo teto da rota.
        await excluirOportunidadesApi(ids);
        return ids;
      }
      const { error } = await db().from('crm_oportunidades').delete().in('id', ids);
      if (error) throw error;
      return ids;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: crmKeys.oportunidades() }); },
  });
}

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

      // O 409 da API vira ErroApi com message 'CONFLITO', o mesmo aviso do onError.
      if (apiDisponivel()) return await moverOportunidadeApi(args);

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
    // O card muda de coluna na hora. Antes ele só se mexia depois da ida ao
    // servidor e de recarregar a lista inteira: com dezenas de negócios, o
    // funil parecia travado no instante em que se solta o card.
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: crmKeys.oportunidades() });
      const anteriores = qc.getQueriesData<CrmOportunidade[]>({ queryKey: crmKeys.oportunidades() });
      qc.setQueriesData<CrmOportunidade[]>(
        { queryKey: crmKeys.oportunidades() },
        (lista) => (lista ?? []).map((o) => (
          o.id === args.id ? { ...o, etapa_id: args.etapaId, ordem: args.ordem } : o
        )),
      );
      return { anteriores };
    },
    onError: (e: unknown, _args, contexto) => {
      // Desfaz o movimento otimista: o card volta para onde estava.
      contexto?.anteriores.forEach(([chave, valor]) => qc.setQueryData(chave, valor));
      if (e instanceof Error && e.message === 'CONFLITO') {
        toast.warning('Este negócio foi movido em outro lugar. Recarreguei para você ver a posição atual.');
      } else {
        toast.error(mensagemDeErro(e, 'Não foi possível mover o negócio.'));
      }
      qc.invalidateQueries({ queryKey: crmKeys.oportunidades() });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: crmKeys.oportunidades() }),
  });
}

export function useCriarOportunidade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nova: Partial<CrmOportunidade>) => {
      // O servidor resolve a conta: id e corretor_id nunca vão.
      if (apiDisponivel()) return await criarOportunidadeApi(escolher(nova, CHAVES_NOVA_OPORTUNIDADE));
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
      if (apiDisponivel()) {
        await registrarHistoricoApi(args.clienteId, {
          tipo: 'WHATSAPP', direcao: 'OUT', conteudo: args.mensagem.slice(0, 500), metadata: { tipo_ui: 'WHATSAPP', via: 'wa.me' },
        });
        // Melhor esforço, como no ramo do Supabase: o contato já foi registrado.
        await atualizarClienteApi(args.clienteId, { ultimo_contato: new Date().toISOString() }).catch(() => undefined);
        return;
      }
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
      if (apiDisponivel()) {
        await concluirTarefaApi(args.id, args.concluida);
        return;
      }
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
      if (apiDisponivel()) {
        await criarTarefaApi(escolher(nova, CHAVES_NOVA_TAREFA));
        return;
      }
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

export type ResultadoConversao =
  | { status: 'converted'; cliente_id: string; created: boolean; oportunidade_id: string | null }
  | { status: 'ja_convertido'; cliente_id: string | null }
  | { status: 'duplicate'; candidatos: CandidatoCliente[] };

const MENSAGENS_CONVERSAO: Record<string, string> = {
  forbidden: 'Este lead não é de uma fachada sua, ou o cliente escolhido é de outra conta.',
  invalid_stage: 'A etapa do pipeline não existe mais. Recarregue a página e tente de novo.',
};

/**
 * Converte um lead da fachada em cliente + oportunidade. É a lacuna que existia:
 * `fachada_leads.convertido` só era exibido como badge e `cliente_id` nunca era
 * preenchido — os leads entravam e ficavam parados.
 *
 * Tudo acontece numa transação no banco (crm_converter_lead): cliente, negócio
 * e "convertido" entram juntos ou nada entra, e o lead fica travado durante a
 * conversão, então clique duplo ou outra aba não criam um segundo cliente.
 * Quando o telefone ou o e-mail já são de um cliente da conta, nada é gravado
 * e a resposta traz os candidatos para o corretor vincular: não existe "criar
 * mesmo assim". `clienteExistente` é o cliente escolhido na tela.
 *
 * No modo legado não há crm_oportunidades: a etapa vai nula e o cliente entra
 * no funil pelo status_funil. Um negócio aberto do cliente é reaproveitado.
 */
export function useConverterLead() {
  const qc = useQueryClient();
  const { data: modo } = useModoCrm();
  return useMutation({
    mutationFn: async (args: {
      lead: { id: string; nome: string; telefone: string; email?: string | null };
      etapaId: string;
      clienteExistente?: string | null;
    }): Promise<ResultadoConversao> => {
      const limpo = normalizarLead(args.lead);
      const { data, error } = apiDisponivel()
        ? await comoResultado(converterLeadApi({
          lead_id: args.lead.id,
          etapa_id: modo === 'completo' ? args.etapaId : null,
          nome: limpo.nome,
          telefone: limpo.telefone,
          email: limpo.email,
          cliente_id: args.clienteExistente ?? null,
        }))
        : await db().rpc('crm_converter_lead', {
          p_lead: args.lead.id,
          // No modo legado a "etapa" é o status_funil ('QUALIFICACAO'), não um uuid.
          p_etapa: modo === 'completo' ? args.etapaId : null,
          p_dados: { nome: limpo.nome, telefone: limpo.telefone, email: limpo.email },
          p_cliente: args.clienteExistente ?? null,
        });
      if (error) throw error;
      const resultado = data as ResultadoConversao;
      return resultado.status === 'duplicate'
        ? { status: 'duplicate', candidatos: candidatosValidos(resultado.candidatos) }
        : resultado;
    },
    onSuccess: async (resultado) => {
      if (resultado.status === 'duplicate') return; // a tela mostra os candidatos
      if (resultado.status === 'ja_convertido') toast.info('Este lead já tinha sido convertido.');
      else if (!resultado.created) toast.success('Lead vinculado ao cliente que já existia.');
      else toast.success(modo === 'completo' ? 'Lead convertido em cliente e oportunidade.' : 'Lead convertido em cliente.');
      // As telas antigas do CRM leem os clientes do store, não do React Query.
      await Promise.all([
        useCRMStore.getState().fetchClientes(),
        qc.invalidateQueries({ queryKey: crmKeys.todos }),
      ]);
    },
    onError: (e) => toast.error(MENSAGENS_CONVERSAO[codigoDoErro(e)] ?? mensagemDeErro(e, 'Não foi possível converter o lead.')),
  });
}
