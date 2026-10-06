import { JWTPayload, SignJWT } from 'jose';

/**
 * Token de ATENDIMENTO (impersonação do backoffice), no lugar do JWT do titular que a Edge
 * `admin-suporte` gerava por magic link e guardava em suporte_privado.credenciais.
 *
 * Mesmo segredo (AUTH_JWT_SECRET), mesmo issuer (AUTH_ISSUER), aud 'authenticated' e alg HS256
 * fixo dos tokens próprios: o guard o verifica pelo mesmo verificarAccessToken. O que muda:
 *  - `sub` é o TITULAR da conta atendida (o RLS e get_corretor_id() enxergam a conta dele);
 *  - `session_id` é admin_sessoes_suporte.auth_session_id — a MESMA claim que
 *    auditar_mutacao_suporte() lê em auth.jwt() para achar a sessão e gravar o ator real;
 *  - `suporte` = { sessao_id, ator }: o guard confere a sessão no banco a cada requisição;
 *  - sem `sv` e sem refresh: vence junto com a sessão (no máximo 30 min) e morre antes se o
 *    atendimento for encerrado ou o papel do administrador for revogado.
 */
export const CLAIM_SUPORTE = 'suporte';

/** Mesmo teto da sessão (admin_sessoes_suporte.expira_em = now() + 30 min). */
export const DURACAO_MAXIMA_SUPORTE_S = 30 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export interface DadosTokenSuporte {
  /** auth.users.id do titular da conta atendida. */
  sub: string;
  email?: string | null;
  /** admin_sessoes_suporte.id */
  sessaoId: string;
  /** admin_sessoes_suporte.auth_session_id (vira a claim session_id). */
  authSessionId: string;
  /** auth.users.id do administrador que abriu o atendimento. */
  atorUserId: string;
  /** admin_sessoes_suporte.expira_em */
  expiraEm: Date;
}

/** A marca de atendimento lida de um token próprio já verificado. */
export interface SuporteDoToken {
  sessaoId: string;
  atorUserId: string;
  authSessionId: string;
}

/**
 * Emite o token de atendimento. `exp` nunca passa da expiração da sessão nem de 30 min a partir
 * de agora; sessão já vencida lança (não existe token de atendimento que nasce morto).
 */
export async function emitirTokenSuporte(
  dados: DadosTokenSuporte,
  opcoes: { segredo: string; issuer: string },
): Promise<{ token: string; exp: number }> {
  const agora = Math.floor(Date.now() / 1000);
  const exp = Math.min(Math.floor(dados.expiraEm.getTime() / 1000), agora + DURACAO_MAXIMA_SUPORTE_S);
  if (!(exp > agora)) throw new Error('sessao_suporte_vencida');
  const token = await new SignJWT({
    role: 'authenticated',
    aud: 'authenticated',
    email: dados.email ?? undefined,
    session_id: dados.authSessionId,
    [CLAIM_SUPORTE]: { sessao_id: dados.sessaoId, ator: dados.atorUserId },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(dados.sub)
    .setIssuer(opcoes.issuer)
    .setIssuedAt(agora)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(opcoes.segredo));
  return { token, exp };
}

/**
 * Lê a marca de atendimento de um token PRÓPRIO já verificado. Null = token comum (sem `suporte`
 * e sem `session_id`). Lança quando a marca vem incompleta ou malformada — a API nunca emite um
 * token próprio assim, então ele é tratado como inválido (401), nunca como token comum.
 */
export function lerSuporte(payload: JWTPayload): SuporteDoToken | null {
  const marca = payload[CLAIM_SUPORTE];
  const authSessionId = payload.session_id;
  if (marca === undefined && authSessionId === undefined) return null;
  if (!marca || typeof marca !== 'object' || Array.isArray(marca)) throw new Error('suporte_invalido');
  const { sessao_id: sessaoId, ator: atorUserId } = marca as Record<string, unknown>;
  if (!ehUuid(sessaoId) || !ehUuid(atorUserId) || !ehUuid(authSessionId)) throw new Error('suporte_invalido');
  return { sessaoId, atorUserId, authSessionId };
}
