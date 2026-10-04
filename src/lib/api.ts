import { supabase } from '@/integrations/supabase/client';

// API Lotti (Railway, padrão do Clix). Sem VITE_API_URL, o front segue falando
// direto com o Supabase, como antes: cada módulo da fase 4 só passa a usar a API
// quando a variável existir (na virada).
const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

export const apiDisponivel = () => !!API_URL;

/** Chamada autenticada à API Lotti (token do Supabase no cabeçalho). Base dos módulos em src/lib/api/. */
export async function chamarApi(caminho: string, init: RequestInit = {}): Promise<Response> {
  if (!API_URL) throw new Error('API Lotti indisponível no momento.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Entre de novo.');
  return fetch(`${API_URL}${caminho}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  });
}

/** Confirma uma visita pedida pelo agente. Lança Error com texto para o usuário. */
export async function confirmarVisita(visitaId: string): Promise<void> {
  if (!API_URL) throw new Error('Confirmação de visita indisponível no momento.');
  const res = await chamarApi(`/api/visitas/${encodeURIComponent(visitaId)}/confirmar`, { method: 'POST' });
  if (res.status === 404) throw new Error('Esta visita já foi resolvida por outra pessoa.');
  if (!res.ok) throw new Error('Não foi possível confirmar a visita. Tente de novo.');
}

/** Alertas do sino, no mesmo formato que o Supabase devolve (colunas do banco). */
export async function listarAlertasApi(): Promise<Array<Record<string, unknown>>> {
  const res = await chamarApi('/api/notificacoes?limite=500');
  if (!res.ok) throw new Error('Não foi possível carregar as notificações.');
  return res.json();
}

/** Marca como lidas (sem ids, todas). Devolve quantas mudaram. */
export async function marcarAlertasLidosApi(ids?: string[]): Promise<number> {
  const res = await chamarApi('/api/notificacoes/lidas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ids ? { ids } : {}),
  });
  if (!res.ok) throw new Error('Não foi possível marcar as notificações.');
  return (await res.json()).marcadas as number;
}

/** Separa os eventos completos de um trecho de SSE; o resto espera o próximo pedaço. */
export function lerEventosSse(buffer: string): { eventos: string[]; resto: string } {
  const partes = buffer.split(/\r?\n\r?\n/);
  const resto = partes.pop() ?? '';
  const eventos = partes
    .map((p) => p.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n'))
    .filter(Boolean);
  return { eventos, resto };
}

/**
 * Escuta o sino ao vivo (SSE da API) com fetch, para o token ir no cabeçalho e
 * nunca na URL. Termina quando a conexão fecha ou o sinal aborta.
 */
export async function escutarSino(aoMudar: () => void, sinal: AbortSignal): Promise<void> {
  const res = await chamarApi('/api/notificacoes/eventos', { headers: { Accept: 'text/event-stream' }, signal: sinal });
  if (!res.ok || !res.body) throw new Error('sino_indisponivel');
  const leitor = res.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) return;
    buffer += decodificador.decode(value, { stream: true });
    const { eventos, resto } = lerEventosSse(buffer);
    buffer = resto;
    for (const e of eventos) {
      try {
        if (JSON.parse(e).tipo === 'alertas') aoMudar();
      } catch {
        // evento fora do formato: ignora
      }
    }
  }
}
