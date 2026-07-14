import { create } from 'zustand';
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
import { toast } from '@/hooks/use-toast';

// Feedback padrão para falhas de escrita: sem isso o erro morre no console
// e o usuário assume que os dados foram salvos.
const toastErro = (titulo: string) =>
  toast({
    variant: 'destructive',
    title: titulo,
    description: 'Verifique sua conexão e tente novamente.',
  });

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

  // Fetch actions
  fetchClientes: () => Promise<void>;
  fetchImoveis: () => Promise<void>;
  fetchContratos: () => Promise<void>;
  fetchCorretor: () => Promise<void>;
  fetchAlertas: () => Promise<void>;
  fetchHistorico: (clienteId?: string) => Promise<void>;

  // Cliente actions
  addCliente: (cliente: Omit<Cliente, 'id' | 'created_at' | 'documentos' | 'imoveis_interesse'>) => Promise<string | null>;
  updateCliente: (id: string, data: Partial<Cliente>) => Promise<boolean>;
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
  tema: 'light',
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

  fetchClientes: async () => {
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('*, cliente_imovel(imovel_id)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const clientesFormatted = (data || []).map(c => ({
        ...c,
        documentos: [],
        imoveis_interesse: c.cliente_imovel?.map((ci: any) => ci.imovel_id) || [],
      }));

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
      if (!data) return;

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
      let query = supabase
        .from('historico_contatos')
        .select('*')
        .order('data', { ascending: false });

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

  addCliente: async (cliente) => {
    try {
      const { data: corretorData } = await supabase.rpc('get_corretor_id');
      if (!corretorData) throw new Error('Corretor não encontrado');

      const { data, error } = await supabase
        .from('clientes')
        .insert({
          ...(cliente as any),
          corretor_id: corretorData,
        } as any)
        .select()
        .single();

      if (error) throw error;

      get().fetchClientes();
      return data.id;
    } catch (error) {
      console.error('Erro ao adicionar cliente:', error);
      toastErro('Erro ao cadastrar cliente');
      return null;
    }
  },

  updateCliente: async (id, data) => {
    try {
      const { error } = await supabase
        .from('clientes')
        .update(data as any)
        .eq('id', id);

      if (error) throw error;
      get().fetchClientes();
      return true;
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      toastErro('Erro ao atualizar cliente');
      return false;
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
      const { error } = await supabase
        .from('clientes')
        .update({ status_funil: status })
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error('Erro ao atualizar status:', error);
      set({ clientes: clientesAnteriores });
      toastErro('Erro ao mover cliente no funil');
    }
  },

  removeCliente: async (id) => {
    try {
      const { error } = await supabase
        .from('clientes')
        .delete()
        .eq('id', id);

      if (error) throw error;
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
      const { data: corretorData } = await supabase.rpc('get_corretor_id');
      if (!corretorData) throw new Error('Corretor não encontrado');

      const { error } = await supabase
        .from('historico_contatos')
        .insert({
          ...historico,
          corretor_id: corretorData,
        });

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
      const { error } = await supabase
        .from('alertas')
        .update({ lido: true })
        .eq('id', id);

      if (error) throw error;
      get().fetchAlertas();
    } catch (error) {
      console.error('Erro ao marcar alerta como lido:', error);
    }
  },

  addContrato: async (contrato) => {
    try {
      const { data: corretorData } = await supabase.rpc('get_corretor_id');
      if (!corretorData) throw new Error('Corretor não encontrado');

      const { data, error } = await supabase
        .from('contratos')
        .insert([{
          tipo: contrato.tipo as any, // Type cast needed for new OUTRO enum value
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
