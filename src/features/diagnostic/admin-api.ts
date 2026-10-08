import { apiDisponivel, chamarApi } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';

const ERRO_PADRAO = 'Não foi possível acessar os diagnósticos. Tente novamente.';

export async function diagnosticAdminRequest<T>(body: Record<string, unknown>): Promise<T> {
  // API Lotti (Railway): POST /api/admin/diagnosticos-crescimento com o mesmo corpo e as mesmas respostas
  // da Edge diagnostic-admin; o token do login próprio vai pelo chamarApi (renova uma vez num 401).
  if (apiDisponivel()) {
    const response = await chamarApi('/api/admin/diagnosticos-crescimento', {
      method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || (response.status === 401 ? 'Entre novamente na Lotti.' : ERRO_PADRAO));
    return data as T;
  }
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error('Entre novamente na Lotti.');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const response = await fetch(`${url}/functions/v1/diagnostic-admin`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || ERRO_PADRAO);
  return data as T;
}
