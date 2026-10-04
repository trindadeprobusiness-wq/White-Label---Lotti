import { create } from 'zustand';
import type { SupabaseClient } from '@supabase/supabase-js';
import { paraRegistro } from '@/lib/crm/historico';
import {
  Cliente,
  Imovel,
  Alerta,
  HistoricoContato,
  Documento,
  Contrato,
  StatusFunil,
  Corretor,
  Preferencias
} from '@/types/crm';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel, listarAlertasApi, marcarAlertasLidosApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { candidatosValidos, clienteDoTelefone, codigoDoErro, type CandidatoCliente } from '@/lib/crm/duplicidade';

// Algumas tabelas ainda estão com os tipos gerados do Supabase defasados em
// relação às migrations. O cliente sem schema tipado fica concentrado aqui,
// sem espalhar casts `any` pelas operações.
const db = supabase as unknown as SupabaseClient;

// Feedback padrão para falhas de escrita: sem isso o erro morre no console
// e o usuário assume que os dados foram salvos.
const toastErro = (titulo: string, description = 'Verifique sua conexão e tente novamente.') =>
  toast({
    variant: 'destructive',
    title: titulo,
    description,
  });

/**
 * Resultado de cadastrar ou editar um cliente. A conta não pode ter dois
 * clientes com o mesmo telefone: em vez de gravar, o banco devolve quem já tem
 * o número, e a tela oferece abrir esse cadastro.
 */
export type ResultadoCliente =
  | { status: 'created' | 'updated'; id: string }
  | { status: 'duplicate'; candidatos: CandidatoCliente[] }
  | { status: 'error' };

// Nome de quem já tem o telefone, para a tela dizer "já é do cliente X". Se a
// busca falhar, o id que veio no erro basta para abrir o cadastro.
async function donoDoTelefone(telefone: string, existente: string, editando?: string): Promise<CandidatoCliente[]> {
  const { data } = await db.rpc('crm_clientes_por_telefone', { p_telefone: telefone });
  const candidatos = candidatosValidos(data).filter((c) => c.motivo === 'telefone' && c.id !== editando);
  return candidatos.length ? candidatos : [{ id: existente, nome: '', motivo: 'telefone' }];
}

const MENSAGENS_CADASTRO: Record<string, string> = {
  forbidden: 'Não foi possível identificar a sua conta. Entre novamente.',
  invalid_name: 'Informe o nome do cliente.',
};

interface CRMStore {
  // Data
  clientes: Cliente[];
  imoveis: Imovel[];
  alertas: Alerta[];
  historico: HistoricoContato[];
  documentos: Documento[];
  contratos: Contrato[];
  corretor: Corretor | null;
  preferencias: Preferencias;
  loading: boolean;

  // Segurança entre sessões: nenhum dado em memória pode sobreviver quando
  // outra pessoa entra no mesmo navegador.
  limparDadosDaSessao: () => void;

  // Fetch actions
  fetchClientes: () => Promise<void>;
  fetchImoveis: () => Promise<void>;
  fetchContratos: () => Promise<void>;
  fetchCorretor: () => Promise<void>;
  fetchAlertas: () => Promise<void>;
  fetchHistorico: (clienteId?: string) => Promise<void>;

  // Cliente actions
  addCliente: (cliente: Omit<Cliente, 'id' | 'created_at' | 'documentos' | 'imoveis_interesse'>) => Promise<ResultadoCliente>;
  updateCliente: (id: string, data: Partial<Cliente>) => Promise<ResultadoCliente>;
  updateClienteStatus: (id: string, status: StatusFunil) => Promise<void>;
  removeCliente: (id: string) => Promise<{ success: boolean; error?: unknown }>;

  // Imovel actions
  addImovel: (imovel: Omit<Imovel, 'id' | 'created_at' | 'clientes_interessados'>) => void;
  updateImovel: (id: string, data: Partial<Imovel>) => void;

  // Historico actions
  addHistorico: (historico: Omit<HistoricoContato, 'id' | 'created_at'>) => Promise<void>;

  // Documento actions
  addDocumento: (documento: Omit<Documento, 'id' | 'created_at'>) => void;

  // Alerta actions
  marcarAlertaLido: (id: string) => Promise<void>;

  // Contrato actions
  addContrato: (contrato: Omit<Contrato, 'id' | 'created_at'>) => Promise<string | null>;
  updateContrato: (id: string, data: Partial<Contrato>) => void;

  // Vinculações
  vincularClienteImovel: (clienteId: string, imovelId: string) => Promise<void>;

  // Configurações actions
  updateCorretor: (data: Partial<Corretor>) => Promise<void>;
  updatePreferencias: (data: Partial<Preferencias>) => void;
  updatePreferenciasNotificacoes: (data: Partial<Preferencias['notificacoes']>) => void;
}

const defaultPreferencias: Preferencias = {
  notificacoes: {
    followup_atrasado: true,
    exclusividade_vencendo: true,
    documento_vencendo: true,
    novo_cliente: false,
  },
  antecedencia_exclusividade_dias: 7,
  antecedencia_documento_dias: 15,
  tema: 'dark',
  sidebar_expandida: true,
  formato_moeda: 'completo',
  ordenacao_clientes: 'ultimo_contato',
};

export const useCRMStore = create<CRMStore>((set, get) => ({
  clientes: [],
  imoveis: [],
  alertas: [],
  historico: [],
  documentos: [],
  contratos: [],
  corretor: null,
  preferencias: defaultPreferencias,
  loading: false,

  limparDadosDaSessao: () => set({
    clientes: [],
    imoveis: [],
    alertas: [],
    historico: [],
    documentos: [],
    contratos: [],
    corretor: null,
    preferencias: defaultPreferencias,
    loading: false,
  }),

  fetchClientes: async () => {
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('*, cliente_imovel(imovel_id)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const clientesFormatted = (data || []).map(c => {
        const vinculos = (c as unknown as { cliente_imovel?: Array<{ imovel_id: string }> }).cliente_imovel;
        return {
          ...c,
          documentos: [],
          imoveis_interesse: vinculos?.map((vinculo) => vinculo.imovel_id) || [],
        };
      });

      set({ clientes: clientesFormatted as Cliente[] });
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
    }
  },

  fetchImoveis: async () => {
    try {
      const { data, error } = await supabase
        .from('imoveis')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const imoveisFormatted = (data || []).map(i => ({
        ...i,
        clientes_interessados: [],
      }));

      set({ imoveis: imoveisFormatted as Imovel[] });
    } catch (error) {
      console.error('Erro ao buscar imóveis:', error);
    }
  },

  fetchContratos: async () => {
    try {
      const { data, error } = await supabase
        .from('contratos')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      set({ contratos: (data || []) as Contrato[] });
    } catch (error) {
      console.error('Erro ao buscar contratos:', error);
    }
  },

  fetchCorretor: async () => {
    try {
      const { data, error } = await supabase
        .from('corretores')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        set({ corretor: null, preferencias: defaultPreferencias });
        return;
      }

      // Deep merge preferencias with defaults to ensure all properties exist
      const dbPrefs = data.preferencias as unknown as Partial<Preferencias> | null;
      const mergedPreferencias: Preferencias = {
        ...defaultPreferencias,
        ...dbPrefs,
        notificacoes: {
          ...defaultPreferencias.notificacoes,
          ...(dbPrefs?.notificacoes || {}),
        },
      };

      set({
        corretor: data as unknown as Corretor,
        preferencias: mergedPreferencias,
      });
    } catch (error) {
      console.error('Erro ao buscar corretor:', error);
    }
  },

  fetchAlertas: async () => {
    try {
      // Fase 4: com a API Lotti ligada (VITE_API_URL), o sino lê por ela.
      if (apiDisponivel()) {
        set({ alertas: (await listarAlertasApi()) as unknown as Alerta[] });
        return;
      }
      const { data, error } = await supabase
        .from('alertas')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        // Fallback for when the table doesn't exist yet
        if (error.code === '42P01') {
          console.warn('Tabela alertas não encontrada, ignorando alertas por enquanto.');
          set({ alertas: [] });
          return;
        }
        throw error;
      }
      set({ alertas: (data || []) as Alerta[] });
    } catch (error) {
      console.error('Erro ao buscar alertas:', error);
      set({ alertas: [] }); // Ensure we don't crash
    }
  },

  fetchHistorico: async (clienteId?: string) => {
    try {
      // A coluna é `data_contato`, não `data`. Ordenar por coluna inexistente
      // fazia a query inteira falhar e a timeline vinha sempre vazia.
      let query = supabase
        .from('historico_contatos')
        .select('*')
        .order('data_contato', { ascending: false });

      if (clienteId) {
        query = query.eq('cliente_id', clienteId);
      }

      const { data, error } = await query;

      if (error) throw error;
      set({ historico: (data || []) as HistoricoContato[] });
    } catch (error) {
      console.error('Erro ao buscar histórico:', error);
    }
  },

  // Só pela RPC: ela procura o telefone em qualquer grafia e cria sob a mesma
  // trava do WhatsApp e da captura, então dois cadastros simultâneos do mesmo
  // número viram um. O dono (corretor_id) é resolvido no servidor.
  addCliente: async (cliente) => {
    try {
      const { data, error } = await db.rpc('crm_criar_cliente', { p_dados: cliente });
      if (error) {
        const existente = clienteDoTelefone(error);
        if (existente) return { status: 'duplicate', candidatos: await donoDoTelefone(cliente.telefone, existente) };
        throw error;
      }
      const resultado = data as { status: string; cliente_id?: string; candidatos?: unknown };
      if (resultado.status === 'duplicate') {
        return { status: 'duplicate', candidatos: candidatosValidos(resultado.candidatos) };
      }
      if (!resultado.cliente_id) throw new Error('crm_criar_cliente sem cliente_id');

      get().fetchClientes();
      return { status: 'created', id: resultado.cliente_id };
    } catch (error) {
      console.error('Erro ao adicionar cliente:', error);
      const mensagem = MENSAGENS_CADASTRO[codigoDoErro(error)];
      if (mensagem) toastErro('Erro ao cadastrar cliente', mensagem); else toastErro('Erro ao cadastrar cliente');
      return { status: 'error' };
    }
  },

  updateCliente: async (id, data) => {
    try {
      const { error } = await db
        .from('clientes')
        .update(data)
        .eq('id', id);

      if (error) {
        // Trocar o telefone para o de outro cliente é recusado pelo banco.
        const existente = clienteDoTelefone(error);
        if (existente) return { status: 'duplicate', candidatos: await donoDoTelefone(data.telefone ?? '', existente, id) };
        throw error;
      }
      get().fetchClientes();
      return { status: 'updated', id };
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      toastErro('Erro ao atualizar cliente');
      return { status: 'error' };
    }
  },

  updateClienteStatus: async (id, status) => {
    // Atualização otimista: move o card imediatamente e reverte se falhar
    const clientesAnteriores = get().clientes;
    set({
      clientes: clientesAnteriores.map((c) =>
        c.id === id ? { ...c, status_funil: status } : c
      ),
    });

    try {
      // Mesma armadilha do delete: UPDATE sem linha afetada não é erro.
      const { data, error } = await supabase
        .from('clientes')
        .update({ status_funil: status })
        .eq('id', id)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('nenhuma_linha_atualizada');
    } catch (error) {
      console.error('Erro ao atualizar status:', error);
      set({ clientes: clientesAnteriores });
      toastErro('Erro ao mover cliente no funil');
    }
  },

  removeCliente: async (id) => {
    try {
      // O `select` não é enfeite: um DELETE barrado pela RLS volta SEM erro e
      // sem linha nenhuma. Sem conferir o que saiu, a tela dizia "excluído" e o
      // cliente continuava lá — que foi exatamente o que o corretor viu.
      const { data, error } = await supabase
        .from('clientes')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('nenhuma_linha_apagada');
      get().fetchClientes();
      return { success: true };
    } catch (error) {
      console.error('Erro ao remover cliente:', error);
      return { success: false, error };
    }
  },

  addImovel: (imovel) =>
    set((state) => ({
      imoveis: [
        ...state.imoveis,
        {
          ...imovel,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          clientes_interessados: [],
        },
      ],
    })),

  updateImovel: (id, data) =>
    set((state) => ({
      imoveis: state.imoveis.map((i) =>
        i.id === id ? { ...i, ...data } : i
      ),
    })),

  addHistorico: async (historico) => {
    try {
      // A tabela em produção NÃO tem corretor_id, descricao nem data — tem
      // cliente_id, tipo (canal_contato), direcao, conteudo, data_contato e
      // metadata. Enviar o formato antigo fazia todo registro de contato ser
      // recusado, e por isso a timeline do cliente nunca preenchia.
      // O escopo por corretor vem da RLS, pelo dono do cliente.
      const registro = paraRegistro({
        clienteId: historico.cliente_id,
        tipo: String((historico as { tipo?: string }).tipo ?? 'NOTA'),
        texto: String((historico as { descricao?: string; conteudo?: string }).descricao
          ?? (historico as { conteudo?: string }).conteudo ?? ''),
      });

      // O types.ts gerado ainda descreve o formato ANTIGO desta tabela (com
      // corretor_id/descricao/data), que não é o que existe em produção. Até os
      // tipos serem regerados, o insert passa pelo cliente sem genérico de schema.
      const { error } = await (supabase as unknown as SupabaseClient)
        .from('historico_contatos').insert(registro);

      if (error) throw error;
      get().fetchHistorico(historico.cliente_id);
    } catch (error) {
      console.error('Erro ao adicionar histórico:', error);
      toastErro('Erro ao registrar contato');
    }
  },

  addDocumento: (documento) =>
    set((state) => ({
      documentos: [
        ...state.documentos,
        {
          ...documento,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        },
      ],
    })),

  marcarAlertaLido: async (id) => {
    try {
      if (apiDisponivel()) {
        await marcarAlertasLidosApi([id]);
      } else {
        const { error } = await supabase
          .from('alertas')
          .update({ lido: true })
          .eq('id', id);

        if (error) throw error;
      }
      get().fetchAlertas();
    } catch (error) {
      console.error('Erro ao marcar alerta como lido:', error);
    }
  },

  addContrato: async (contrato) => {
    try {
      const { data: corretorData } = await supabase.rpc('get_corretor_id');
      if (!corretorData) throw new Error('Corretor não encontrado');

      const { data, error } = await db
        .from('contratos')
        .insert([{
          tipo: contrato.tipo,
          cliente_id: contrato.cliente_id,
          imovel_id: contrato.imovel_id,
          valor: contrato.valor,
          data_inicio: contrato.data_inicio,
          prazo_meses: contrato.prazo_meses,
          dia_vencimento: contrato.dia_vencimento,
          indice_reajuste: contrato.indice_reajuste,
          conteudo: contrato.conteudo,
          status: contrato.status,
          versao: contrato.versao,
          modelo_ia: contrato.modelo_ia,
          tempo_geracao_ms: contrato.tempo_geracao_ms,
          corretor_id: corretorData,
        }])
        .select()
        .single();

      if (error) throw error;
      get().fetchContratos();
      return data.id;
    } catch (error) {
      console.error('Erro ao adicionar contrato:', error);
      return null;
    }
  },

  updateContrato: (id, data) =>
    set((state) => ({
      contratos: state.contratos.map((c) =>
        c.id === id ? { ...c, ...data } : c
      ),
    })),

  vincularClienteImovel: async (clienteId, imovelId) => {
    try {
      // First, remove existing links to ensure 1:1 relationship for the UI
      await supabase
        .from('cliente_imovel')
        .delete()
        .eq('cliente_id', clienteId);

      // Then insert the new link
      const { error } = await supabase
        .from('cliente_imovel')
        .insert({
          cliente_id: clienteId,
          imovel_id: imovelId,
        });

      if (error && !error.message.includes('duplicate')) throw error;

      // Refresh the list to update UI immediately
      get().fetchClientes();
    } catch (error) {
      console.error('Erro ao vincular cliente ao imóvel:', error);
      toastErro('Erro ao vincular imóvel ao cliente');
    }
  },

  updateCorretor: async (data) => {
    try {
      const corretor = get().corretor;
      if (!corretor) return;

      const { error } = await supabase
        .from('corretores')
        .update(data)
        .eq('id', corretor.id);

      if (error) throw error;
      set({ corretor: { ...corretor, ...data } as Corretor });
    } catch (error) {
      console.error('Erro ao atualizar corretor:', error);
      toastErro('Erro ao salvar configurações');
    }
  },

  updatePreferencias: (data) =>
    set((state) => ({
      preferencias: { ...state.preferencias, ...data },
    })),

  updatePreferenciasNotificacoes: (data) =>
    set((state) => ({
      preferencias: {
        ...state.preferencias,
        notificacoes: { ...state.preferencias.notificacoes, ...data },
      },
    })),
}));
