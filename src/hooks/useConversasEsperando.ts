import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { latestByConversation, liveUrgency, type LatestMessage } from '@/features/whatsapp-inbox/liveInboxFilters';

/**
 * Quantas conversas estão esperando resposta agora.
 *
 * A tela inicial não mostrava nada do atendimento, que é o que mais consome o
 * dia. A conta é a mesma do Inbox (`liveUrgency`), para os dois números nunca
 * discordarem: conta só conversa cuja última mensagem é do cliente e cujo
 * atendimento não está com a IA.
 */

// As tabelas do runtime ainda não estão no types.ts gerado.
const db = supabase as unknown as SupabaseClient;

type ConversaEspera = {
  id: string;
  mode: 'ai' | 'human' | 'paused';
  qualification: { priority?: string } | null;
};

export interface Espera {
  esperando: number;
  urgentes: number;
}

export function useConversasEsperando() {
  const { user } = useAuth();
  return useQuery<Espera>({
    queryKey: ['inicio', 'conversas-esperando', user?.id],
    enabled: !!user,
    // O Inbox sonda a cada 3s; aqui é um resumo, meio minuto basta e não pesa.
    refetchInterval: 30_000,
    queryFn: async () => {
      const [conversas, mensagens] = await Promise.all([
        db.from('lotti_agent_conversations').select('id,mode,qualification').limit(100),
        db.from('lotti_agent_latest_messages').select('conversation_id,direction,created_at,content'),
      ]);
      if (conversas.error) throw conversas.error;
      if (mensagens.error) throw mensagens.error;

      const ultimas = latestByConversation((mensagens.data ?? []) as LatestMessage[]);
      const agora = Date.now();
      let esperando = 0;
      let urgentes = 0;
      for (const conversa of (conversas.data ?? []) as ConversaEspera[]) {
        const urgencia = liveUrgency(
          { mode: conversa.mode, qualification: conversa.qualification ?? undefined },
          ultimas.get(conversa.id),
          agora,
        );
        if (urgencia === 'all') continue;
        esperando += 1;
        if (urgencia === 'urgent') urgentes += 1;
      }
      return { esperando, urgentes };
    },
  });
}
