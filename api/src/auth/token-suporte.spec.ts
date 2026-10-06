import { SignJWT } from 'jose';
import { CLAIM_SUPORTE, DURACAO_MAXIMA_SUPORTE_S, emitirTokenSuporte, lerSuporte } from './token-suporte';
import { emitirAccessToken, verificarAccessToken } from './tokens';

const segredo = 'segredo-proprio-com-mais-de-32-caracteres!!';
const issuer = 'lotti-api';
const TITULAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSAO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AUTH_SESSAO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const dados = (expiraEm: Date) => ({
  sub: TITULAR, email: 'titular@exemplo.com', sessaoId: SESSAO, authSessionId: AUTH_SESSAO, atorUserId: ADMIN, expiraEm,
});

describe('token de atendimento', () => {
  it('sai com sub do titular, session_id da sessão, a marca suporte e sem sv; verifica como token próprio', async () => {
    const expiraEm = new Date(Date.now() + 20 * 60_000);
    const { token, exp } = await emitirTokenSuporte(dados(expiraEm), { segredo, issuer });
    const claims = await verificarAccessToken(token, { segredo, issuer });
    expect(claims).toMatchObject({
      sub: TITULAR, role: 'authenticated', aud: 'authenticated', iss: issuer, email: 'titular@exemplo.com',
      session_id: AUTH_SESSAO, [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN },
    });
    expect(claims.sv).toBeUndefined();
    expect(claims.exp).toBe(exp);
    expect(exp).toBeLessThanOrEqual(Math.floor(expiraEm.getTime() / 1000));
    expect(lerSuporte(claims)).toEqual({ sessaoId: SESSAO, atorUserId: ADMIN, authSessionId: AUTH_SESSAO });
  });

  it('exp nunca passa de 30 min, mesmo que a sessão diga mais', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const { exp } = await emitirTokenSuporte(dados(new Date(Date.now() + 5 * 3_600_000)), { segredo, issuer });
    expect(exp).toBeLessThanOrEqual(agora + DURACAO_MAXIMA_SUPORTE_S + 1);
  });

  it('sessão já vencida não gera token', async () => {
    await expect(emitirTokenSuporte(dados(new Date(Date.now() - 1000)), { segredo, issuer })).rejects.toThrow('sessao_suporte_vencida');
  });

  it('token comum não tem marca; marca incompleta ou malformada é recusada', async () => {
    const comum = await verificarAccessToken(
      await emitirAccessToken({ sub: TITULAR, sessionVersion: 0 }, { segredo, issuer, ttlSegundos: 900 }), { segredo, issuer });
    expect(lerSuporte(comum)).toBeNull();
    expect(() => lerSuporte({ sub: TITULAR, session_id: AUTH_SESSAO })).toThrow('suporte_invalido');
    expect(() => lerSuporte({ sub: TITULAR, [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN } })).toThrow('suporte_invalido');
    expect(() => lerSuporte({ sub: TITULAR, session_id: AUTH_SESSAO, [CLAIM_SUPORTE]: { sessao_id: 'x', ator: ADMIN } })).toThrow('suporte_invalido');
    expect(() => lerSuporte({ sub: TITULAR, session_id: AUTH_SESSAO, [CLAIM_SUPORTE]: [SESSAO, ADMIN] })).toThrow('suporte_invalido');
  });

  it('alg diferente de HS256 não verifica', async () => {
    const outro = await new SignJWT({ role: 'authenticated', aud: 'authenticated', session_id: AUTH_SESSAO, [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN } })
      .setProtectedHeader({ alg: 'HS512' }).setSubject(TITULAR).setIssuer(issuer).setExpirationTime('5m')
      .sign(new TextEncoder().encode(segredo));
    await expect(verificarAccessToken(outro, { segredo, issuer })).rejects.toThrow();
  });
});
