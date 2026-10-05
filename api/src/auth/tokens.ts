import { JWTPayload, jwtVerify, SignJWT } from 'jose';
import { SupabaseClaims } from '../prisma/tenant-db';

/**
 * Access token próprio da API (HS256, chave AUTH_JWT_SECRET).
 *
 * As claims são iguais às do Supabase de propósito: o TenantDb, o RLS e
 * get_corretor_id() leem `sub`, `role` e `email` e não podem notar diferença
 * entre um token e o outro. `sv` (session_version) viaja junto só para o
 * /refresh poder matar sessões logo após a troca de senha; o guard não olha
 * para ele.
 */
export interface DadosAccessToken {
  /** auth.users.id preservado — o MESMO id usado como claims.sub hoje. */
  sub: string;
  email?: string;
  /** Versão de sessão do usuário no momento da emissão. */
  sessionVersion: number;
}

/** O que sai do access token verificado, no formato que o guard grava em request.claims. */
export interface ClaimsProprias extends SupabaseClaims {
  sub: string;
  role: 'authenticated';
  /** session_version embutida; presente só nos tokens próprios. */
  sv?: number;
}

const codificar = (segredo: string): Uint8Array => new TextEncoder().encode(segredo);

/**
 * Emite um access token curto. `iss` fixo (AUTH_ISSUER) e `aud` 'authenticated'
 * fecham a porta para confundir com o token do Supabase mesmo os dois sendo HS256.
 */
export async function emitirAccessToken(
  dados: DadosAccessToken,
  opcoes: { segredo: string; issuer: string; ttlSegundos: number },
): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  return new SignJWT({
    role: 'authenticated',
    aud: 'authenticated',
    email: dados.email,
    sv: dados.sessionVersion,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(dados.sub)
    .setIssuer(opcoes.issuer)
    .setIssuedAt(agora)
    .setExpirationTime(agora + opcoes.ttlSegundos)
    .sign(codificar(opcoes.segredo));
}

/**
 * Verifica um access token próprio. `algorithms: ['HS256']` recusa `alg:none` e
 * qualquer troca de algoritmo; issuer e audience fixos recusam o token do
 * Supabase. Pós-condição idêntica à do guard de hoje: role 'authenticated' e sub
 * string, senão lança.
 */
export async function verificarAccessToken(
  token: string,
  opcoes: { segredo: string; issuer: string },
): Promise<ClaimsProprias> {
  const { payload } = await jwtVerify(token, codificar(opcoes.segredo), {
    algorithms: ['HS256'],
    issuer: opcoes.issuer,
    audience: 'authenticated',
  });
  if ((payload as JWTPayload).role !== 'authenticated' || typeof payload.sub !== 'string') {
    throw new Error('claims_invalidas');
  }
  return payload as ClaimsProprias;
}
