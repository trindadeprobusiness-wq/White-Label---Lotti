import type { Session, User } from '@supabase/supabase-js';

// Login próprio da API Lotti (saída do Supabase Auth). Só é usado atrás de
// apiDisponivel() / VITE_API_URL — sem a variável, o front segue 100% no
// supabase.auth e nada aqui é instanciado.
//
// REGRAS DE OURO:
// - O access token (JWT curto da API) vive SÓ em memória. Nunca em
//   localStorage/cookie legível: refresh é por cookie HttpOnly que o navegador
//   manda sozinho com credentials:'include'.
// - claims.sub preservado = auth.users.id. O User que montamos usa esse id, para
//   RLS, get_corretor_id() e TenantDb continuarem idênticos.
// - Nenhum segredo é lido ou logado; senha nunca aparece em log.

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

export type Resultado = { ok: boolean; erro?: string };

/** Claims que a API devolve em /me e embute no access token. */
export interface ClaimsApi {
  sub: string;
  email?: string | null;
  role?: string | null;
}

/**
 * Resposta de /login e /refresh. O controller da API devolve camelCase
 * (`{ accessToken, expiresIn }`); estes nomes precisam bater com ele, senão o
 * token chega `undefined` e todo login contra a API falha.
 */
interface RespostaToken {
  accessToken: string;
  expiresIn?: number;
}

const MSG_LOGIN = 'E-mail ou senha incorretos.';
const MSG_SESSAO = 'Sua sessão expirou. Entre de novo.';
const MSG_GENERICA = 'Se existir uma conta, enviaremos instruções.';
const MSG_RECUPERACAO_OFF = 'A recuperação de senha ainda não está disponível. Fale com o suporte.';

/** Folga antes do vencimento para renovar; nunca agenda em menos de 10s. */
const FOLGA_REFRESH_MS = 60_000;
const MIN_REFRESH_MS = 10_000;
const TTL_PADRAO_S = 900;

function url(caminho: string): string {
  if (!BASE) throw new Error('API Lotti indisponível no momento.');
  return `${BASE}${caminho}`;
}

/**
 * Monta um User/Session mínimos compatíveis com o supabase-js a partir das
 * claims da API. Só os campos que o app realmente lê (id, email) são reais; o
 * resto satisfaz o tipo. O access_token vai no Session para quem precisar lê-lo
 * da mesma forma que lia o do Supabase.
 */
function montarUsuario(claims: ClaimsApi): User {
  return {
    id: claims.sub,
    email: claims.email ?? undefined,
    app_metadata: { provider: 'lotti' },
    user_metadata: {},
    aud: claims.role ?? 'authenticated',
    created_at: '',
  } as unknown as User;
}

function montarSessao(claims: ClaimsApi, accessToken: string, expiraEmS: number): Session {
  return {
    access_token: accessToken,
    refresh_token: '',
    token_type: 'bearer',
    expires_in: expiraEmS,
    expires_at: Math.floor(Date.now() / 1000) + expiraEmS,
    user: montarUsuario(claims),
  } as unknown as Session;
}

type Ouvinte = (sessao: Session | null) => void;

/**
 * Estado da sessão própria. Um só para o app inteiro (igual ao AuthProvider ter
 * um só listener). useAuth assina `aoMudar` e espelha no contexto React.
 */
class ClienteAuth {
  private accessToken: string | null = null;
  private sessao: Session | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ouvintes = new Set<Ouvinte>();

  /** Assina mudanças de sessão. Devolve o cancelador. */
  aoMudar(ouvinte: Ouvinte): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  private notificar(): void {
    for (const o of this.ouvintes) o(this.sessao);
  }

  private limparTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Agenda a renovação pouco antes do access vencer. */
  private agendarRefresh(expiraEmS: number): void {
    this.limparTimer();
    const atraso = Math.max(expiraEmS * 1000 - FOLGA_REFRESH_MS, MIN_REFRESH_MS);
    this.timer = setTimeout(() => { void this.refresh(); }, atraso);
  }

  /** Aplica um par (token, claims) recém-emitido: guarda, monta sessão, agenda. */
  private async aplicarToken(dados: RespostaToken): Promise<void> {
    this.accessToken = dados.accessToken;
    const expiraEmS = dados.expiresIn && dados.expiresIn > 0 ? dados.expiresIn : TTL_PADRAO_S;
    const claims = await this.buscarClaims();
    this.sessao = montarSessao(claims, dados.accessToken, expiraEmS);
    this.agendarRefresh(expiraEmS);
    this.notificar();
  }

  private limparSessao(): void {
    this.limparTimer();
    this.accessToken = null;
    this.sessao = null;
  }

  /** GET /me com o access token. Lança se não houver sessão/token válido. */
  private async buscarClaims(): Promise<ClaimsApi> {
    if (!this.accessToken) throw new Error(MSG_SESSAO);
    const res = await fetch(url('/api/auth/me'), {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(MSG_SESSAO);
    const corpo = (await res.json()) as ClaimsApi;
    if (!corpo?.sub) throw new Error(MSG_SESSAO);
    return corpo;
  }

  /** Sessão atual (síncrona), para useAuth ler no boot e no snapshot. */
  obterSessao(): Session | null {
    return this.sessao;
  }

  /** Access token atual, em memória. Para chamadas autenticadas futuras. */
  obterAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * POST /login. Em qualquer falha devolve a MESMA mensagem genérica — não
   * revela se o e-mail existe nem diferencia senha errada de conta ausente.
   */
  async login(email: string, senha: string): Promise<Resultado> {
    try {
      const res = await fetch(url('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, senha }),
      });
      if (!res.ok) return { ok: false, erro: MSG_LOGIN };
      await this.aplicarToken((await res.json()) as RespostaToken);
      return { ok: true };
    } catch {
      return { ok: false, erro: MSG_LOGIN };
    }
  }

  /**
   * POST /refresh. Usa só o cookie HttpOnly (rotação no servidor). Em falha,
   * derruba a sessão local e notifica — o usuário cai para a tela de login.
   * Devolve true quando renovou.
   */
  async refresh(): Promise<boolean> {
    try {
      const res = await fetch(url('/api/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        this.limparSessao();
        this.notificar();
        return false;
      }
      await this.aplicarToken((await res.json()) as RespostaToken);
      return true;
    } catch {
      this.limparSessao();
      this.notificar();
      return false;
    }
  }

  /**
   * Tenta restaurar a sessão no boot a partir do cookie de refresh. Silencioso:
   * sem cookie válido simplesmente não há sessão. Devolve a sessão (ou null).
   */
  async restaurar(): Promise<Session | null> {
    await this.refresh();
    return this.sessao;
  }

  /** POST /logout: revoga a família no servidor e limpa o estado local. Idempotente. */
  async logout(): Promise<void> {
    try {
      await fetch(url('/api/auth/logout'), { method: 'POST', credentials: 'include' });
    } catch {
      /* mesmo se a rede falhar, limpamos o estado local abaixo */
    }
    this.limparSessao();
    this.notificar();
  }

  /**
   * POST /forgot-password. Enquanto o e-mail (Resend) não existe, a rota devolve
   * sempre 200 genérico e não envia nada. Tratamos qualquer resposta como
   * sucesso genérico para nunca revelar se a conta existe.
   */
  async pedirRecuperacao(email: string): Promise<Resultado> {
    try {
      await fetch(url('/api/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      /* resposta genérica mesmo em falha de rede: não vaza existência */
    }
    return { ok: true, erro: undefined };
  }

  /**
   * POST /reset-password. Desabilitada nesta fase: a API responde 503 neutro.
   * Devolvemos erro genérico sem detalhe.
   */
  async definirNovaSenha(token: string, senha: string): Promise<Resultado> {
    try {
      const res = await fetch(url('/api/auth/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, senha }),
      });
      if (res.ok) return { ok: true };
      return { ok: false, erro: MSG_RECUPERACAO_OFF };
    } catch {
      return { ok: false, erro: MSG_RECUPERACAO_OFF };
    }
  }
}

/** Instância única usada pelo useAuth. */
export const clienteAuth = new ClienteAuth();

export { MSG_GENERICA };
