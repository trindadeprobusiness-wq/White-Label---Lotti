import type { User } from '@supabase/supabase-js';

export interface SessaoSuporte {
  id: string;
  corretor_id: string;
  nome: string;
  expira_em: string;
  user: User;
  /**
   * Só no modo API (VITE_API_URL): token curto de atendimento assinado pela API (sub = titular),
   * que vale enquanto a sessão estiver ativa no servidor e nunca é renovado. No modo Supabase o
   * JWT do titular fica no servidor e este campo não existe.
   */
  token?: string;
}

export const CHAVE_SUPORTE = 'lotti:suporte';

export function obterSuporte(): SessaoSuporte | null {
  try {
    const valor = JSON.parse(sessionStorage.getItem(CHAVE_SUPORTE) ?? 'null') as SessaoSuporte | null;
    return valor?.id && valor.user?.id && valor.expira_em ? valor : null;
  } catch { return null; }
}

export function salvarSuporte(sessao: SessaoSuporte) {
  sessionStorage.setItem(CHAVE_SUPORTE, JSON.stringify(sessao));
}

export function limparSuporte() { sessionStorage.removeItem(CHAVE_SUPORTE); }

/**
 * Token de atendimento da API para o Bearer. Null quando não há atendimento, quando ele não tem
 * token (sessão aberta pelo Supabase) ou quando já venceu — quem chama NUNCA cai no token do
 * administrador nesses casos.
 */
export function tokenSuporteApi(sessao: SessaoSuporte | null = obterSuporte()): string | null {
  if (!sessao?.token || !(Date.parse(sessao.expira_em) > Date.now())) return null;
  return sessao.token;
}

/** Somente APIs de dados passam pelo atendimento; Auth continua sendo do administrador. */
export function criarFetchSuporte(base: string, original: typeof fetch): typeof fetch {
  return async (input, init) => {
    const sessao = obterSuporte();
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const destino = new URL(base);
    if (!sessao || url.origin !== destino.origin ||
        !/^\/(rest|storage|functions)\/v1\//.test(url.pathname) ||
        url.pathname === '/functions/v1/admin-suporte') return original(input, init);
    if (Date.parse(sessao.expira_em) <= Date.now()) {
      return new Response(JSON.stringify({ message: 'O atendimento expirou. Abra uma nova sessão pelo backoffice.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    const pedido = new Request(input, init);
    const proxy = new URL('/functions/v1/admin-suporte', base);
    proxy.searchParams.set('sessao', sessao.id);
    proxy.searchParams.set('path', url.pathname + url.search);
    return original(proxy, {
      method: pedido.method,
      headers: pedido.headers,
      body: ['GET', 'HEAD'].includes(pedido.method) ? undefined : await pedido.arrayBuffer(),
      signal: pedido.signal,
    });
  };
}
