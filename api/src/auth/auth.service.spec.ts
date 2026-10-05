import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppEnv } from '../config/env';
import { AuthService, hashRefresh } from './auth.service';
import { RefreshTokenGravado, UsuarioAuth, UsuariosRepo } from './usuarios.repo';

const baseEnv: AppEnv = {
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x',
  supabaseUrl: 'https://abc.supabase.co', corsOrigins: [],
  authJwtSecret: 'segredo-proprio-com-mais-de-32-caracteres!!',
  authAccessTtl: 900, authRefreshTtl: 2592000, authIssuer: 'lotti-api', emailHabilitado: false,
};

const SENHA = 'senha-correta-123';
const HASH = bcrypt.hashSync(SENHA, 10);

/** Repo em memória: tabelas usuarios e auth_refresh_tokens como Maps. */
class RepoFake {
  usuarios = new Map<string, UsuarioAuth>();
  tokens = new Map<string, RefreshTokenGravado & { tokenHash: string }>();
  seq = 0;

  add(u: UsuarioAuth): void { this.usuarios.set(u.id, u); }

  async buscarPorEmail(email: string): Promise<UsuarioAuth | null> {
    for (const u of this.usuarios.values()) if (u.email.toLowerCase() === email) return u;
    return null;
  }
  async buscarPorId(id: string): Promise<UsuarioAuth | null> { return this.usuarios.get(id) ?? null; }
  async sessionVersion(id: string): Promise<number | null> { return this.usuarios.get(id)?.sessionVersion ?? null; }

  async inserirRefreshToken(d: { userId: string; familyId: string; tokenHash: string; sessionVersion: number; expiresAt: Date }): Promise<string> {
    const id = `t${this.seq++}`;
    this.tokens.set(id, { id, userId: d.userId, familyId: d.familyId, tokenHash: d.tokenHash, sessionVersion: d.sessionVersion, expiresAt: d.expiresAt, usedAt: null, revokedAt: null });
    return id;
  }
  async buscarRefreshPorHash(hash: string): Promise<RefreshTokenGravado | null> {
    for (const t of this.tokens.values()) if (t.tokenHash === hash) return { ...t };
    return null;
  }
  async marcarUsado(id: string): Promise<number> {
    const t = this.tokens.get(id);
    if (!t || t.usedAt) return 0;
    t.usedAt = new Date();
    return 1;
  }
  async revogarFamilia(familyId: string): Promise<number> {
    let n = 0;
    for (const t of this.tokens.values()) if (t.familyId === familyId && !t.revokedAt) { t.revokedAt = new Date(); n++; }
    return n;
  }
}

function montar(env: AppEnv = baseEnv): { service: AuthService; repo: RepoFake } {
  const repo = new RepoFake();
  const service = new AuthService(env, repo as unknown as UsuariosRepo);
  return { service, repo };
}

const usuario = (over: Partial<UsuarioAuth> = {}): UsuarioAuth => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'corretor@exemplo.com',
  passwordHash: HASH, status: 'ativo', sessionVersion: 0, ...over,
});

describe('AuthService.login', () => {
  it('emite sessão com a senha certa e grava o hash do refresh (nunca o cru)', async () => {
    const { service, repo } = montar();
    repo.add(usuario());
    const sessao = await service.login('Corretor@Exemplo.com', SENHA);
    expect(sessao.accessToken.split('.')).toHaveLength(3);
    expect(sessao.refreshToken.length).toBeGreaterThan(20);
    // o banco só guarda o hash
    const guardado = [...repo.tokens.values()][0];
    expect(guardado.tokenHash).toBe(hashRefresh(sessao.refreshToken));
    expect(guardado.tokenHash).not.toBe(sessao.refreshToken);
  });

  it('senha errada, conta inexistente, sem senha e inativa: sempre a MESMA mensagem genérica', async () => {
    const MSG = 'E-mail ou senha incorretos. Verifique os dados e tente novamente.';
    const capturar = async (p: Promise<unknown>): Promise<string> => {
      try { await p; } catch (e) { return (e as Error).message; }
      throw new Error('esperava erro');
    };

    const senhaErrada = montar(); senhaErrada.repo.add(usuario());
    const inexistente = montar();
    const semSenha = montar(); semSenha.repo.add(usuario({ passwordHash: null }));
    const inativa = montar(); inativa.repo.add(usuario({ status: 'inativo' }));

    expect(await capturar(senhaErrada.service.login('corretor@exemplo.com', 'senha-errada'))).toBe(MSG);
    expect(await capturar(inexistente.service.login('ninguem@exemplo.com', 'x'))).toBe(MSG);
    expect(await capturar(semSenha.service.login('corretor@exemplo.com', SENHA))).toBe(MSG);
    expect(await capturar(inativa.service.login('corretor@exemplo.com', SENHA))).toBe(MSG);
  });

  it('503 quando AUTH_JWT_SECRET não está configurado', async () => {
    const { service, repo } = montar({ ...baseEnv, authJwtSecret: undefined });
    repo.add(usuario());
    await expect(service.login('corretor@exemplo.com', SENHA)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('AuthService.refresh', () => {
  it('rotaciona: novo par válido, refresh anterior fica usado', async () => {
    const { service, repo } = montar();
    repo.add(usuario());
    const s1 = await service.login('corretor@exemplo.com', SENHA);
    const s2 = await service.refresh(s1.refreshToken);
    expect(s2.refreshToken).not.toBe(s1.refreshToken);
    const antigo = [...repo.tokens.values()].find((t) => t.tokenHash === hashRefresh(s1.refreshToken));
    expect(antigo?.usedAt).toBeInstanceOf(Date);
  });

  it('reuso de um refresh já usado revoga a FAMÍLIA inteira', async () => {
    const { service, repo } = montar();
    repo.add(usuario());
    const s1 = await service.login('corretor@exemplo.com', SENHA);
    await service.refresh(s1.refreshToken); // usa uma vez
    await expect(service.refresh(s1.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException); // reuso
    // toda a família revogada
    expect([...repo.tokens.values()].every((t) => t.revokedAt)).toBe(true);
  });

  it('troca de senha (session_version avançou) invalida a família', async () => {
    const { service, repo } = montar();
    repo.add(usuario());
    const s1 = await service.login('corretor@exemplo.com', SENHA);
    repo.usuarios.get(usuario().id)!.sessionVersion = 1; // simula reset de senha
    await expect(service.refresh(s1.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect([...repo.tokens.values()].every((t) => t.revokedAt)).toBe(true);
  });

  it('sem cookie de refresh: 401 genérico', async () => {
    const { service } = montar();
    await expect(service.refresh(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.logout', () => {
  it('revoga a família do refresh e é idempotente sem cookie', async () => {
    const { service, repo } = montar();
    repo.add(usuario());
    const s1 = await service.login('corretor@exemplo.com', SENHA);
    await service.logout(s1.refreshToken);
    expect([...repo.tokens.values()].every((t) => t.revokedAt)).toBe(true);
    await expect(service.logout(undefined)).resolves.toBeUndefined();
  });
});

describe('AuthService recuperação (desabilitada nesta fase)', () => {
  it('forgot-password sempre devolve mensagem genérica, sem revelar existência', async () => {
    const { service, repo } = montar();
    repo.add(usuario());
    const existe = await service.forgotPassword('corretor@exemplo.com');
    const naoExiste = await service.forgotPassword('ninguem@exemplo.com');
    expect(existe).toEqual(naoExiste);
    expect(existe.mensagem).toMatch(/se existir uma conta/i);
  });

  it('reset-password responde 503 enquanto o e-mail não existir', async () => {
    const { service } = montar();
    await expect(service.resetPassword('token', 'nova-senha-123')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
