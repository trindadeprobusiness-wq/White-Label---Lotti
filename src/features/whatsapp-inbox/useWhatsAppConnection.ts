import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { erroDaPonte } from './bridgeError';

export type WhatsAppConnectionState = {
  state: 'connected' | 'connecting' | 'disconnected';
  agentEnabled: boolean;
  phone?: string;
  connectedAt?: string;
  qr?: string;
  qrExpiresAt?: number;
  qrGeneration?: string;
};

export function useWhatsAppConnectionQuery(userId?: string) {
  return useQuery({
    queryKey: ['whatsapp-connection', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<WhatsAppConnectionState>('lotti-whatsapp', { body: { action: 'status' } });
      // Sem carregar o código, a tela só sabe dizer "indisponível".
      if (error || !data) throw await erroDaPonte(error);
      return data;
    },
    refetchInterval: query => query.state.data?.state === 'connecting' ? 2000 : query.state.data?.state === 'connected' ? 8000 : 10000,
    // Voltar para a aba em menos de 30s não precisa perguntar de novo: a
    // resposta anterior ainda vale, e a sondagem periódica continua rodando.
    staleTime: 30_000,
    retry: 1,
  });
}
