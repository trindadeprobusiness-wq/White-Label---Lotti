import { SignJWT } from 'jose';
import { emitirAccessToken, verificarAccessToken } from './tokens';

const segredo = 'segredo-proprio-com-mais-de-32-caracteres!!';
const issuer = 'lotti-api';

describe('tokens do login próprio', () => {
  it('emite com as mesmas claims do Supabase (sub, role, email, aud, iss, sv)', async () => {
    const token = await emitirAccessToken(
      { sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'c@exemplo.com', sessionVersion: 3 },
      { segredo, issuer, ttlSegundos: 900 },
    );
    const claims = await verificarAccessToken(token, { segredo, issuer });
    expect(claims.sub).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(claims.role).toBe('authenticated');
    expect(claims.email).toBe('c@exemplo.com');
    expect(claims.aud).toBe('authenticated');
    expect(claims.iss).toBe(issuer);
    expect(claims.sv).toBe(3);
  });

  it('recusa assinatura trocada', async () => {
    const token = await emitirAccessToken({ sub: 'x', sessionVersion: 0 }, { segredo, issuer, ttlSegundos: 900 });
    await expect(verificarAccessToken(token, { segredo: 'outra-chave-qualquer-com-mais-de-32-caracteres', issuer }))
      .rejects.toBeTruthy();
  });

  it('recusa alg:none (token forjado sem assinatura)', async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const agora = Math.floor(Date.now() / 1000);
    const forjado = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      sub: 'x', role: 'authenticated', aud: 'authenticated', iss: issuer, exp: agora + 300,
    })}.`;
    await expect(verificarAccessToken(forjado, { segredo, issuer })).rejects.toBeTruthy();
  });

  it('recusa issuer diferente (cross-issuer)', async () => {
    const token = await new SignJWT({ role: 'authenticated', aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('x').setIssuer('https://abc.supabase.co/auth/v1').setAudience('authenticated')
      .setExpirationTime('5m').sign(new TextEncoder().encode(segredo));
    await expect(verificarAccessToken(token, { segredo, issuer })).rejects.toBeTruthy();
  });

  it('recusa token expirado', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: 'authenticated', aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('x').setIssuer(issuer).setAudience('authenticated')
      .setIssuedAt(agora - 100).setExpirationTime(agora - 10).sign(new TextEncoder().encode(segredo));
    await expect(verificarAccessToken(token, { segredo, issuer })).rejects.toBeTruthy();
  });

  it('recusa role diferente de authenticated', async () => {
    const token = await new SignJWT({ role: 'anon', aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('x').setIssuer(issuer).setAudience('authenticated')
      .setExpirationTime('5m').sign(new TextEncoder().encode(segredo));
    await expect(verificarAccessToken(token, { segredo, issuer })).rejects.toBeTruthy();
  });
});
