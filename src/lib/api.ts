import { obterSuporte, tokenSuporteApi } from '@/lib/admin/suporte';
import { clienteAuth } from '@/lib/api/auth';

// API Lotti (Railway, padrão do Clix). Sem VITE_API_URL, o front segue falando
// direto com o Supabase, como antes: cada módulo da fase 4 só passa a usar a API
// quando a variável existir (na virada).
const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

export const apiDisponivel = () => !!API_URL;

const MSG_SESSAO_EXPIRADA = 'Sua sessão expirou. Entre de novo.';
const MSG_ATENDIMENTO_EXPIRADO = 'O atendimento expirou. Abra uma nova sessão pelo backoffice.';

/** Token do login próprio de quem está logado (o administrador, durante o atendimento). */
async function obterTokenDoLogin(): Promise<string> {
  const token = await clienteAuth.obterTokenValido();
  if (!token) throw new Error(MSG_SESSAO_EXPIRADA);
  return token;
}

/**
 * Bearer das chamadas à API. Com VITE_API_URL o login é o próprio da API
 * (useAuth → clienteAuth): o token vive em memória e, vencido, é renovado pelo
 * cookie de refresh uma vez. NUNCA cai na sessão do Supabase: um token antigo
 * guardado no navegador (de antes da virada, ou de outra pessoa) faria a API
 * responder como outra conta. Exportado para quem faz fetch próprio (SSE).
 *
 * Durante o atendimento do backoffice (aba com obterSuporte()), o Bearer é SÓ o
 * token de atendimento (sub = titular). Sem ele, ou vencido, a chamada falha: o
 * token do administrador nunca vai buscar dados da conta atendida.
 */
export async function obterTokenApi(): Promise<string> {
  if (obterSuporte()) {
    const token = tokenSuporteApi();
    if (!token) throw new Error(MSG_ATENDIMENTO_EXPIRADO);
    return token;
  }
  return obterTokenDoLogin();
}

/** Corpo que dá para mandar de novo depois de um 401 (stream já consumido não dá). */
function corpoReenviavel(body: RequestInit['body']): boolean {
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
}

/**
 * Chamada autenticada à API Lotti (token do login próprio no cabeçalho). Base dos
 * módulos em src/lib/api/. Se a API recusar o token (401: venceu no servidor
 * antes do relógio daqui, senha trocada), renova uma vez e repete a chamada; se
 * não houver mais sessão, devolve o 401 para quem chamou tratar.
 */
export async function chamarApi(caminho: string, init: RequestInit = {}): Promise<Response> {
  if (!API_URL) throw new Error('API Lotti indisponível no momento.');
  // Atendimento: token de atendimento e nenhuma renovação — renovar devolveria o
  // token do administrador. 401/403 (sessão encerrada no servidor) voltam como vieram.
  if (obterSuporte()) return enviarComToken(caminho, init, await obterTokenApi());
  return chamarComLogin(caminho, init);
}

/**
 * Chamada como quem está LOGADO, mesmo numa aba de atendimento: só para abrir e
 * encerrar o atendimento (rotas do administrador, que recusam o token de atendimento).
 */
export async function chamarApiAdministrador(caminho: string, init: RequestInit = {}): Promise<Response> {
  if (!API_URL) throw new Error('API Lotti indisponível no momento.');
  return chamarComLogin(caminho, init);
}

function enviarComToken(caminho: string, init: RequestInit, token: string): Promise<Response> {
  return fetch(`${API_URL}${caminho}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  });
}

async function chamarComLogin(caminho: string, init: RequestInit): Promise<Response> {
  const token = await obterTokenDoLogin();
  const res = await enviarComToken(caminho, init, token);
  if (res.status !== 401 || !corpoReenviavel(init.body) || init.signal?.aborted) return res;
  const novo = await clienteAuth.renovarAposRecusa(token);
  return novo ? enviarComToken(caminho, init, novo) : res;
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
