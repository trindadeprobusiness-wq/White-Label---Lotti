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
  rejectAction: (actionId: string) => Promise<void>;
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

function aiModuleFromPath(pathname: string): string {
  const routes: Array<[string, string]> = [
    ['/clientes', 'clients'],
    ['/crm', 'funnel'],
    ['/funil', 'funnel'],
    ['/imoveis', 'properties'],
    ['/contratos', 'contracts'],
    ['/juridico', 'legal'],
    ['/alugueis', 'rentals'],
    ['/financeiro', 'finance'],
    ['/midias', 'media'],
    ['/rotina', 'agenda'],
    ['/agenda', 'agenda'],
    ['/dashboard', 'dashboard'],
  ];
  return routes.find(([route]) => pathname.startsWith(route))?.[1] ?? 'assistant';
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
            module: aiModuleFromPath(window.location.pathname),
            intent: 'assistant.chat',
            locale: 'pt-BR',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
            output_mode: 'text',
            trace_id: crypto.randomUUID(),
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sua sessão expirou. Entre novamente.');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-action`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ proposal_id: action.id, decision: 'confirm' }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Não foi possível executar a ação.');
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

  const rejectAction = useCallback(async (actionId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sua sessão expirou. Entre novamente.');
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-action`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ proposal_id: actionId, decision: 'reject' }),
        },
      );
      if (!response.ok) throw new Error('Não foi possível recusar a ação.');
      setPendingActions(prev =>
        prev.map(a => (a.id === actionId ? { ...a, status: 'rejected' as const } : a))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível recusar a ação.';
      setError(message);
      toast.error(message);
    }
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
