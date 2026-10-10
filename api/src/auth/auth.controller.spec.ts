import { ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppEnv } from '../config/env';
import { AuthController, ipDoCliente } from './auth.controller';
import { AuthService, SessaoEmitida } from './auth.service';

const envProd: AppEnv = {
  isProd: true, port: 3001, databaseUrl: 'x', redisUrl: 'x',
  corsOrigins: ['https://app'],
  authJwtSecret: 'segredo-proprio-com-mais-de-32-caracteres!!',
  authAccessTtl: 900, authRefreshTtl: 2592000, authIssuer: 'lotti-api',
  authCookieDomain: 'app.exemplo.com', emailHabilitado: false,
};

const sessao: SessaoEmitida = { accessToken: 'a.b.c', refreshToken: 'refresh-opaco-xyz', accessTtl: 900, refreshTtl: 2592000 };

function resFake(): { res: Response; cookies: string[] } {
  const cookies: string[] = [];
  const res = { append: (_k: string, v: string | string[]) => { cookies.push(...(Array.isArray(v) ? v : [v])); } } as unknown as Response;
  return { res, cookies };
}
function reqFake(cookie?: string): Request {
  return { headers: cookie ? { cookie } : {} } as unknown as Request;
}

describe('AuthController', () => {
  it('login grava o cookie HttpOnly Secure SameSite=Lax Path=/api/auth e devolve o access no corpo', async () => {
    const servico = { login: jest.fn(async () => sessao) } as unknown as AuthService;
    const { res, cookies } = resFake();
    const corpo = await new AuthController(envProd, servico).login({ email: 'c@x.com', senha: 's' }, res);
    expect(corpo).toEqual({ accessToken: 'a.b.c', expiresIn: 900 });
    const [cookie] = cookies;
    expect(cookie).toContain('lotti_refresh=refresh-opaco-xyz');
    expect(cookie).toContain('Path=/api/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Domain=app.exemplo.com');
    expect(cookie).toContain('Max-Age=2592000');
  });

  it('em dev (sem isProd) o cookie não leva Secure', async () => {
    const servico = { login: jest.fn(async () => sessao) } as unknown as AuthService;
    const { res, cookies } = resFake();
    await new AuthController({ ...envProd, isProd: false, authCookieDomain: undefined }, servico).login({ email: 'c@x.com', senha: 's' }, res);
    expect(cookies[0]).not.toContain('Secure');
    expect(cookies[0]).not.toContain('Domain=');
  });

  it('refresh lê o cookie, repassa ao serviço e regrava um cookie novo', async () => {
    const refresh = jest.fn(async () => sessao);
    const servico = { refresh } as unknown as AuthService;
    const { res, cookies } = resFake();
    await new AuthController(envProd, servico).refresh(reqFake('outro=1; lotti_refresh=valor-do-cookie; x=2'), res);
    expect(refresh).toHaveBeenCalledWith('valor-do-cookie');
    expect(cookies[0]).toContain('lotti_refresh=refresh-opaco-xyz');
  });

  it('logout revoga pelo cookie e o limpa com Max-Age=0', async () => {
    const logout = jest.fn(async () => undefined);
    const servico = { logout } as unknown as AuthService;
    const { res, cookies } = resFake();
    const corpo = await new AuthController(envProd, servico).logout(reqFake('lotti_refresh=abc'), res);
    expect(logout).toHaveBeenCalledWith('abc');
    expect(corpo).toEqual({ ok: true });
    expect(cookies[0]).toContain('Max-Age=0');
  });

  it('/me espelha as claims resolvidas pelo guard', () => {
    const controller = new AuthController(envProd, {} as unknown as AuthService);
    const saida = controller.me({ sub: 'u1', email: 'c@x.com', role: 'authenticated' });
    expect(saida).toEqual({ sub: 'u1', email: 'c@x.com', role: 'authenticated' });
  });

  it('forgot-password devolve a mensagem genérica do serviço', async () => {
    const servico = { forgotPassword: jest.fn(async () => ({ mensagem: 'Se existir uma conta...' })) } as unknown as AuthService;
    const corpo = await new AuthController(envProd, servico).forgotPassword({ email: 'c@x.com' });
    expect(corpo.mensagem).toMatch(/se existir uma conta/i);
  });

  it('reset-password propaga o 503 do serviço (desabilitado)', async () => {
    const servico = { resetPassword: jest.fn(async () => { throw new ServiceUnavailableException(); }) } as unknown as AuthService;
    await expect(new AuthController(envProd, servico).resetPassword({ token: 't', senha: 'nova-senha-123' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('AuthController.cadastro', () => {
  it('repassa o IP do proxy e grava o mesmo cookie do login', async () => {
    const cadastrar = jest.fn(async () => sessao);
    const { res, cookies } = resFake();
    const req = { headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as Request;
    const dto = { email: 'n@x.com', senha: 'segredo1', nome: 'Nova', cnpj: '11.222.333/0001-81', telefone: '62999990000' };
    const corpo = await new AuthController(envProd, { cadastrar } as unknown as AuthService).cadastro(dto, req, res);
    expect(corpo).toEqual({ accessToken: 'a.b.c', expiresIn: 900 });
    expect(cadastrar).toHaveBeenCalledWith(dto, '203.0.113.9');
    expect(cookies[0]).toContain('lotti_refresh=refresh-opaco-xyz');
    expect(cookies[0]).toContain('HttpOnly');
  });
});

describe('ipDoCliente', () => {
  it('usa o último salto do x-forwarded-for, depois x-real-ip, depois o socket', () => {
    const req = (headers: Record<string, string>, ip?: string) => ({ headers, socket: { remoteAddress: ip } }) as unknown as Request;
    expect(ipDoCliente(req({ 'x-forwarded-for': 'forjado, 203.0.113.9' }))).toBe('203.0.113.9');
    expect(ipDoCliente(req({ 'x-real-ip': ' 198.51.100.2 ' }))).toBe('198.51.100.2');
    expect(ipDoCliente(req({}, '10.0.0.1'))).toBe('10.0.0.1');
    expect(ipDoCliente(req({}))).toBeNull();
  });
});

describe('AuthController.definirSenha', () => {
  it('repassa token, senha e IP do proxy e grava o mesmo cookie do login', async () => {
    const definirSenha = jest.fn(async () => sessao);
    const { res, cookies } = resFake();
    const req = { headers: { 'x-forwarded-for': '203.0.113.9' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as Request;
    const corpo = await new AuthController(envProd, { definirSenha } as unknown as AuthService)
      .definirSenha({ token: 'tok', senha: 'senha-nova-123' }, req, res);
    expect(corpo).toEqual({ accessToken: 'a.b.c', expiresIn: 900 });
    expect(definirSenha).toHaveBeenCalledWith('tok', 'senha-nova-123', '203.0.113.9');
    expect(cookies[0]).toContain('lotti_refresh=refresh-opaco-xyz');
    expect(cookies[0]).toContain('HttpOnly');
  });
});
