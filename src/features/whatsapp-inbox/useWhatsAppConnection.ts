import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type WhatsAppConnectionState = {
  state: 'connected' | 'connecting' | 'disconnected';
  agentEnabled: boolean;
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
      if (error || !data) throw error ?? new Error('connection_unavailable');
      return data;
    },
    refetchInterval: query => query.state.data?.state === 'connecting' ? 2000 : query.state.data?.state === 'connected' ? 8000 : 10000,
    retry: 1,
  });
}
