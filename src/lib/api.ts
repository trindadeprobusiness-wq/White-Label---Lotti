import { supabase } from '@/integrations/supabase/client';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

export const apiDisponivel = () => !!API_URL;

/** Confirma uma visita pedida pelo agente. Lança Error com texto para o usuário. */
export async function confirmarVisita(visitaId: string): Promise<void> {
  if (!API_URL) throw new Error('Confirmação de visita indisponível no momento.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Entre de novo.');
  const res = await fetch(`${API_URL}/api/visitas/${encodeURIComponent(visitaId)}/confirmar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) throw new Error('Esta visita já foi resolvida por outra pessoa.');
  if (!res.ok) throw new Error('Não foi possível confirmar a visita. Tente de novo.');
}
