import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import {
  abrirAssistenteApi,
  alterarConversaIaApi,
  apagarConversaIaApi,
  decidirAcaoIaApi,
  enviarAnexoIaApi,
  listarConversasIaApi,
  listarMensagensIaApi,
} from '@/lib/api/ia';
import type { AIConversation, AIMessage, AISuggestedAction, AIStreamChunk } from '@/types/ai';

interface UseAIChatReturn {
  messages: AIMessage[];
  conversations: AIConversation[];
  activeConversation: string | null;
  isStreaming: boolean;
  error: string | null;
  sendMessage: (text: string, fileContext?: string, opcoes?: OpcoesEnvio) => Promise<void>;
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

/** intent do pedido: 'assistant.chat' (padrão) ou outro modo do servidor, como 'onboarding.help'. */
export interface OpcoesEnvio {
  intent?: string;
}

/**
 * Conversa reaberta: só falas com texto (as rodadas de consulta ficam gravadas sem texto) e respostas seguidas
 * da IA viram uma só, como apareceram ao vivo, com o rodapé da última.
 */
export function mensagensVisiveis(linhas: AIMessage[]): AIMessage[] {
  const saida: AIMessage[] = [];
  for (const m of linhas) {
    if ((m.role !== 'user' && m.role !== 'assistant') || !m.content?.trim()) continue;
    const anterior = saida[saida.length - 1];
    if (m.role === 'assistant' && anterior?.role === 'assistant') {
      saida[saida.length - 1] = { ...m, id: anterior.id, content: `${anterior.content}\n\n${m.content}`, created_at: anterior.created_at };
    } else {
      saida.push(m);
    }
  }
  return saida;
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
    ['/planejamento', 'agenda'],
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
  const lastOpcoesRef = useRef<OpcoesEnvio | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  /** Trocar ou limpar a conversa encerra o stream em andamento: a resposta não cai na conversa errada. */
  const encerrarStream = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  };

  const loadConversations = useCallback(async () => {
    if (apiDisponivel()) {
      // Como no Supabase: erro de leitura deixa a lista vazia, sem estourar.
      const lista = await listarConversasIaApi().catch(() => []);
      setConversations(sortConversations(lista as unknown as AIConversation[]));
      return;
    }
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
    let falhou: boolean;
    if (apiDisponivel()) {
      falhou = await alterarConversaIaApi(id, { pinned }).then(() => false, () => true);
    } else {
      const { error } = await supabase
        .from('ai_conversations')
        .update({ pinned })
        .eq('id', id);
      falhou = !!error;
    }
    if (falhou) {
      toast.error('Não foi possível fixar a conversa.');
      await loadConversations(); // reverte para o estado real
    }
  }, [loadConversations]);

  const deleteConversation = useCallback(async (id: string) => {
    const snapshot = conversations;
    // Otimista: some da lista imediatamente
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversation === id) {
      encerrarStream();
      setActiveConversation(null);
      setMessages([]);
      setPendingActions([]);
      setError(null);
    }
    let falhou: boolean;
    if (apiDisponivel()) {
      falhou = await apagarConversaIaApi(id).then(() => false, () => true);
    } else {
      const { error } = await supabase.from('ai_conversations').delete().eq('id', id);
      falhou = !!error;
    }
    if (falhou) {
      toast.error('Não foi possível excluir a conversa.');
      setConversations(snapshot); // restaura
      return;
    }
    toast.success('Conversa excluída.');
  }, [conversations, activeConversation]);

  const loadConversation = useCallback(async (id: string) => {
    encerrarStream();
    setActiveConversation(id);
    setError(null);
    setPendingActions([]);

    let data: Array<{ role: string }> | null;
    if (apiDisponivel()) {
      data = (await listarMensagensIaApi(id).catch(() => null)) as Array<{ role: string }> | null;
    } else {
      const resposta = await supabase
        .from('ai_messages')
        .select('*')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });
      data = resposta.data as unknown as Array<{ role: string }> | null;
    }

    setMessages(mensagensVisiveis((data || []) as AIMessage[]));
  }, []);

  const startConversation = useCallback(() => {
    encerrarStream();
    setActiveConversation(null);
    setMessages([]);
    setError(null);
    setPendingActions([]);
  }, []);

  const sendMessage = useCallback(async (text: string, fileContext?: string, opcoes?: OpcoesEnvio) => {
    if (!text.trim() && !fileContext) return;
    setError(null);
    lastMessageRef.current = text;
    lastFileContextRef.current = fileContext;
    lastOpcoesRef.current = opcoes;

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
    const controle = new AbortController();
    abortRef.current = controle;
    // Envio que já não é o atual (a pessoa trocou de conversa no meio): os eventos dele são ignorados.
    const atual = () => abortRef.current === controle;
    // Turno que termina sem texto e sem ação não pode sumir calado: vira erro com "Tentar novamente".
    let trouxeAlgo = false;

    try {
      const corpo = {
        message: text,
        conversation_id: activeConversation,
        file_context: fileContext,
        module: aiModuleFromPath(window.location.pathname),
        intent: opcoes?.intent ?? 'assistant.chat',
        locale: 'pt-BR',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
        output_mode: 'text',
        trace_id: crypto.randomUUID(),
      };
      let response: Response;
      if (apiDisponivel()) {
        // Mesmo stream e mesmos eventos da Edge Function; erro antes do stream vem como ErroApi.
        response = await abrirAssistenteApi(corpo, controle.signal);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Sua sessão expirou. Entre novamente.');

        response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(corpo),
            signal: controle.signal,
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: '' }));
          throw new Error(errorData.error || `O assistente não respondeu (erro ${response.status}). Tente novamente.`);
        }
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

          if (!atual()) break;
          try {
            const chunk: AIStreamChunk = JSON.parse(raw);

            if (chunk.type === 'text' && chunk.content) {
              if (chunk.content.trim()) trouxeAlgo = true;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: m.content + chunk.content }
                    : m
                )
              );
            }

            if (chunk.type === 'action' && chunk.action) {
              trouxeAlgo = true;
              setPendingActions(prev => [...prev, chunk.action!]);
            }

            if (chunk.type === 'done') {
              const convId = chunk.conversation_id;
              if (convId && !activeConversation) {
                setActiveConversation(convId);
              }
              // Rodapé da resposta ao vivo; reaberta, a conversa traz o mesmo metadata gravado pela API.
              if (typeof chunk.duracao_ms === 'number') {
                const rodape = { consultas: chunk.consultas, duracao_ms: chunk.duracao_ms };
                setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, metadata: { ...m.metadata, ...rodape } } : m)));
              }
              if (!trouxeAlgo) {
                setError('O assistente não trouxe resposta. Tente novamente.');
                setMessages(prev => prev.filter(m => m.id !== assistantId));
              }
              loadConversations();
            }

            if (chunk.type === 'error') {
              setError(chunk.error || 'O assistente não conseguiu responder. Tente novamente.');
              // Sem texto, a resposta vazia não fica na tela.
              setMessages(prev => prev.filter(m => m.id !== assistantId || m.content.trim()));
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError' || !atual()) return;
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
      if (atual()) {
        setIsStreaming(false);
        abortRef.current = null;
      }
    }
  }, [activeConversation, loadConversations]);

  const uploadFile = useCallback(async (file: File) => {
    try {
      if (apiDisponivel()) return await enviarAnexoIaApi(file);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sua sessão expirou. Entre novamente.');

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
        const errorData = await response.json().catch(() => ({ error: '' }));
        throw new Error(errorData.error || 'Não foi possível enviar o arquivo.');
      }

      return await response.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar arquivo');
      return null;
    }
  }, []);

  const confirmAction = useCallback(async (action: AISuggestedAction) => {
    try {
      let body: { existing?: boolean; error?: string } | null;
      if (apiDisponivel()) {
        body = await decidirAcaoIaApi(action.id, 'confirm');
      } else {
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
        body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error || 'Não foi possível executar a ação.');
        }
      }

      setPendingActions(prev =>
        prev.map(a => (a.id === action.id ? { ...a, status: 'confirmed' as const } : a))
      );
      // "Cadastrar cliente" com um telefone que já é cliente não cria outro.
      toast.success(body?.existing
        ? 'Este cliente já estava cadastrado. Nenhum cadastro novo foi criado.'
        : 'Ação executada com sucesso.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao executar ação';
      setError(msg);
      toast.error(msg);
    }
  }, []);

  const rejectAction = useCallback(async (actionId: string) => {
    try {
      if (apiDisponivel()) {
        await decidirAcaoIaApi(actionId, 'reject');
      } else {
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
      }
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
      await sendMessage(lastMessageRef.current, lastFileContextRef.current, lastOpcoesRef.current);
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
