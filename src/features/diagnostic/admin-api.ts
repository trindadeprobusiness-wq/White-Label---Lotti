import { clienteAuth } from '@/lib/api/auth';
import { apiDisponivel } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';

export async function diagnosticAdminRequest<T>(body: Record<string, unknown>): Promise<T> {
  const token = apiDisponivel() ? await clienteAuth.obterTokenValido() : (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error('Entre novamente na Lotti.');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const response = await fetch(`${url}/functions/v1/diagnostic-admin`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Não foi possível acessar os diagnósticos. Tente novamente.');
  return data as T;
}
