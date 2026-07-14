import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { AIConversation, AIMessage, AISuggestedAction, AIStreamChunk } from '@/types/ai';

interface UseAIChatReturn {
  messages: AIMessage[];
  conversations: AIConversation[];
  activeConversation: string | null;
  isStreaming: boolean;
  error: string | null;
  sendMessage: (text: string, fileContext?: string) => Promise<void>;
  uploadFile: (file: File) => Promise<{ extracted_text: string; file_name: string } | null>;
  startConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  togglePin: (id: string, pinned: boolean) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  confirmAction: (action: AISuggestedAction) => Promise<void>;
  rejectAction: (actionId: string) => void;
  retry: () => Promise<void>;
  pendingActions: AISuggestedAction[];
}

// Ordena fixadas primeiro; dentro de cada grupo o Array.sort estável do V8
// preserva a ordem por updated_at desc que já veio do banco.
function sortConversations(list: AIConversation[]): AIConversation[] {
  return [...list].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)
  );
}

export function useAIChat(): UseAIChatReturn {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<AISuggestedAction[]>([]);
  const lastMessageRef = useRef<string>('');
  const lastFileContextRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from('ai_conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(50);
    setConversations(sortConversations((data || []) as AIConversation[]));
  }, []);

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    // Atualização otimista (reordena na hora)
    setConversations((prev) =>
      sortConversations(prev.map((c) => (c.id === id ? { ...c, pinned } : c)))
    );
    const { error } = await supabase
      .from('ai_conversations')
      .update({ pinned })
      .eq('id', id);
    if (error) {
      toast.error('Não foi possível fixar a conversa.');
      await loadConversations(); // reverte para o estado real
    }
  }, [loadConversations]);

  const deleteConversation = useCallback(async (id: string) => {
    const snapshot = conversations;
    // Otimista: some da lista imediatamente
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversation === id) {
      setActiveConversation(null);
      setMessages([]);
      setPendingActions([]);
      setError(null);
    }
    const { error } = await supabase.from('ai_conversations').delete().eq('id', id);
    if (error) {
      toast.error('Não foi possível excluir a conversa.');
      setConversations(snapshot); // restaura
      return;
    }
    toast.success('Conversa excluída.');
  }, [conversations, activeConversation]);

  const loadConversation = useCallback(async (id: string) => {
    setActiveConversation(id);
    setError(null);
    setPendingActions([]);

    const { data } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    const msgs = (data || []).filter(
      (m: { role: string }) => m.role === 'user' || m.role === 'assistant'
    ) as AIMessage[];

    setMessages(msgs);
  }, []);

  const startConversation = useCallback(() => {
    setActiveConversation(null);
    setMessages([]);
    setError(null);
    setPendingActions([]);
  }, []);

  const sendMessage = useCallback(async (text: string, fileContext?: string) => {
    if (!text.trim() && !fileContext) return;
    setError(null);
    lastMessageRef.current = text;
    lastFileContextRef.current = fileContext;

    const userMsg: AIMessage = {
      id: crypto.randomUUID(),
      conversation_id: activeConversation || '',
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    const assistantId = crypto.randomUUID();
    const assistantMsg: AIMessage = {
      id: assistantId,
      conversation_id: activeConversation || '',
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, assistantMsg]);

    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: text,
            conversation_id: activeConversation,
            file_context: fileContext,
          }),
          signal: abortRef.current.signal,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const chunk: AIStreamChunk = JSON.parse(raw);

            if (chunk.type === 'text' && chunk.content) {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: m.content + chunk.content }
                    : m
                )
              );
            }

            if (chunk.type === 'action' && chunk.action) {
              setPendingActions(prev => [...prev, chunk.action!]);
            }

            if (chunk.type === 'done') {
              const convId = (chunk as unknown as { conversation_id?: string }).conversation_id;
              if (convId && !activeConversation) {
                setActiveConversation(convId);
              }
              loadConversations();
            }

            if (chunk.type === 'error') {
              setError(chunk.error || 'Unknown error');
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // "Failed to fetch" = falha de rede/CORS (ex.: Edge Function fora do ar)
      const message =
        err instanceof TypeError
          ? 'Não foi possível conectar ao assistente. Tente novamente em instantes.'
          : err instanceof Error
            ? err.message
            : 'Erro ao enviar mensagem';
      setError(message);
      setMessages(prev => prev.filter(m => m.id !== assistantId));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [activeConversation, loadConversations]);

  const uploadFile = useCallback(async (file: File) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-process-file`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errorData.error);
      }

      return await response.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar arquivo');
      return null;
    }
  }, []);

  const confirmAction = useCallback(async (action: AISuggestedAction) => {
    try {
      const { data: corretorData } = await supabase.rpc('get_corretor_id');
      if (!corretorData) throw new Error('Corretor not found');

      switch (action.action_type) {
        case 'create_client': {
          const p = action.params as { nome: string; telefone: string; tipo_interesse?: string };
          await supabase.from('clientes').insert({
            nome: p.nome,
            telefone: p.telefone || '',
            tipo_interesse: p.tipo_interesse || 'COMPRA',
            corretor_id: corretorData,
          });
          break;
        }
        case 'update_client_status': {
          const p = action.params as { client_id: string; status: string };
          await supabase.from('clientes').update({ status_funil: p.status }).eq('id', p.client_id);
          break;
        }
        case 'schedule_followup': {
          const p = action.params as { client_id: string; date: string };
          await supabase.from('clientes').update({ proximo_followup: p.date }).eq('id', p.client_id);
          break;
        }
        case 'create_alert': {
          const p = action.params as { mensagem: string; tipo?: string; prioridade?: string };
          await supabase.from('alertas').insert({
            mensagem: p.mensagem,
            tipo: p.tipo || 'GERAL',
            prioridade: p.prioridade || 'MEDIA',
            corretor_id: corretorData,
          });
          break;
        }
        case 'register_contact': {
          const p = action.params as { client_id: string; tipo: string; descricao: string };
          await supabase.from('historico_contatos').insert({
            cliente_id: p.client_id,
            tipo: p.tipo || 'NOTA',
            descricao: p.descricao,
            corretor_id: corretorData,
          });
          break;
        }
        case 'create_property': {
          // Cadastra um imóvel na aba Imóveis (mesmas colunas do NovoImovelDialog).
          const p = action.params as {
            titulo: string;
            tipo?: string;
            valor?: number;
            area_m2?: number;
            dormitorios?: number;
            garagem?: number;
            endereco?: string;
            bairro?: string;
            cidade?: string;
            proprietario_nome?: string;
          };
          const tiposValidos = ['APARTAMENTO', 'CASA', 'COMERCIAL', 'TERRENO'];
          const { error: insErr } = await supabase.from('imoveis').insert({
            titulo: p.titulo,
            tipo: tiposValidos.includes(p.tipo || '') ? p.tipo : 'APARTAMENTO',
            valor: Number(p.valor) || 0,
            area_m2: Number(p.area_m2) || 0,
            dormitorios: Number(p.dormitorios) || 0,
            garagem: Number(p.garagem) || 0,
            endereco: p.endereco || '',
            bairro: p.bairro || '',
            cidade: p.cidade || '',
            proprietario_nome: p.proprietario_nome || '',
            corretor_id: corretorData,
          });
          if (insErr) throw insErr;
          break;
        }
        case 'create_financial_entry': {
          // Lança uma receita/despesa na aba Financeiro.
          const p = action.params as {
            tipo?: string;
            categoria?: string;
            descricao: string;
            valor?: number;
            data?: string;
            recorrente?: boolean;
          };
          const { error: insErr } = await supabase.from('lancamentos_financeiros').insert({
            tipo: p.tipo === 'RECEITA' ? 'RECEITA' : 'DESPESA',
            categoria: p.categoria || 'OUTROS',
            descricao: p.descricao,
            valor: Number(p.valor) || 0,
            data: p.data || new Date().toISOString().slice(0, 10),
            recorrente: p.recorrente ?? false,
            corretor_id: corretorData,
          });
          if (insErr) throw insErr;
          break;
        }
      }

      setPendingActions(prev =>
        prev.map(a => (a.id === action.id ? { ...a, status: 'confirmed' as const } : a))
      );
      toast.success('Ação executada com sucesso.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao executar ação';
      setError(msg);
      toast.error(msg);
    }
  }, []);

  const rejectAction = useCallback((actionId: string) => {
    setPendingActions(prev =>
      prev.map(a => (a.id === actionId ? { ...a, status: 'rejected' as const } : a))
    );
  }, []);

  const retry = useCallback(async () => {
    if (lastMessageRef.current) {
      await sendMessage(lastMessageRef.current, lastFileContextRef.current);
    }
  }, [sendMessage]);

  return {
    messages,
    conversations,
    activeConversation,
    isStreaming,
    error,
    sendMessage,
    uploadFile,
    startConversation,
    loadConversation,
    loadConversations,
    togglePin,
    deleteConversation,
    confirmAction,
    rejectAction,
    retry,
    pendingActions,
  };
}
