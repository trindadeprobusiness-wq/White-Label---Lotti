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

describe('AuthService.cadastrar', () => {
  const dados = { email: '  Nova@Exemplo.com ', senha: 'senha-nova-1', nome: ' Nova Corretora ', cnpj: '11.222.333/0001-81', telefone: '(62) 99999-0000' };

  /** Repo do cadastro: conta nova em memória, limite contado por escopo/chave. */
  function montarCadastro(opcoes: { limite?: number; existente?: boolean } = {}) {
    const { service, repo } = montar();
    const contagem = new Map<string, number>();
    const criadas: Array<Record<string, unknown>> = [];
    const extra = repo as unknown as Record<string, unknown>;
    extra.consumirLimite = jest.fn(async (escopo: string, chave: string, limite: number) => {
      const k = `${escopo}:${chave}`;
      const n = (contagem.get(k) ?? 0) + 1;
      contagem.set(k, n);
      return n <= Math.min(limite, opcoes.limite ?? limite);
    });
    extra.criarConta = jest.fn(async (d: { email: string; passwordHash: string }) => {
      if (opcoes.existente) return null;
      criadas.push(d);
      const u = usuario({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: d.email, passwordHash: d.passwordHash });
      repo.add(u);
      return u;
    });
    return { service, repo, criadas, consumirLimite: extra.consumirLimite as jest.Mock, contagem };
  }

  it('cria a conta com e-mail normalizado e bcrypt, e já devolve a sessão (como o login)', async () => {
    const { service, repo, criadas } = montarCadastro();
    const sessao = await service.cadastrar(dados, '203.0.113.9');
    expect(sessao.accessToken.split('.')).toHaveLength(3);
    expect(repo.tokens.size).toBe(1);
    expect(criadas[0]).toMatchObject({ email: 'nova@exemplo.com', nome: 'Nova Corretora', cnpj: '11.222.333/0001-81', telefone: '(62) 99999-0000' });
    const hash = criadas[0].passwordHash as string;
    expect(hash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('senha-nova-1', hash)).toBe(true);
    // e o login seguinte com a mesma senha funciona
    await expect(service.login('nova@exemplo.com', 'senha-nova-1')).resolves.toHaveProperty('accessToken');
  });

  it('e-mail que já tem conta: 409 genérico, sem sessão', async () => {
    const { service, repo } = montarCadastro({ existente: true });
    await expect(service.cadastrar(dados, '203.0.113.9')).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ codigo: 'email_em_uso' }) });
    expect(repo.tokens.size).toBe(0);
  });

  it('acima do limite por IP: 429 antes de tocar na conta; a chave do IP não é o IP cru', async () => {
    const { service, criadas, consumirLimite } = montarCadastro({ limite: 1 });
    await service.cadastrar(dados, '203.0.113.9');
    await expect(service.cadastrar({ ...dados, email: 'outra@exemplo.com' }, '203.0.113.9')).rejects.toMatchObject({ status: 429 });
    expect(criadas).toHaveLength(1);
    const [escopo, chave] = consumirLimite.mock.calls[0] as [string, string];
    expect(escopo).toBe('auth-cadastro-ip');
    expect(chave).toMatch(/^[0-9a-f]{64}$/);
    expect(chave).not.toContain('203.0.113.9');
  });

  it('503 sem AUTH_JWT_SECRET, antes de qualquer gravação', async () => {
    const repo = new RepoFake() as unknown as Record<string, unknown>;
    repo.consumirLimite = jest.fn();
    repo.criarConta = jest.fn();
    const service = new AuthService({ ...baseEnv, authJwtSecret: undefined }, repo as unknown as UsuariosRepo);
    await expect(service.cadastrar(dados, null)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.criarConta).not.toHaveBeenCalled();
  });
});

describe('AuthService.definirSenha (link de uso único)', () => {
  const TOKEN = 'A'.repeat(43);

  /** Repo do link: limite contado por escopo/chave e um token válido que vira a senha. */
  function montarLink(opcoes: { limite?: number; valido?: boolean } = {}) {
    const { service, repo } = montar();
    repo.add(usuario({ passwordHash: null }));
    const contagem = new Map<string, number>();
    const extra = repo as unknown as Record<string, unknown>;
    extra.consumirLimite = jest.fn(async (escopo: string, chave: string, limite: number) => {
      const k = `${escopo}:${chave}`;
      const n = (contagem.get(k) ?? 0) + 1;
      contagem.set(k, n);
      return n <= Math.min(limite, opcoes.limite ?? limite);
    });
    extra.consumirTokenSenha = jest.fn(async (tokenHash: string, passwordHash: string) => {
      if (opcoes.valido === false) return null;
      const u = repo.usuarios.get(usuario().id)!;
      u.passwordHash = passwordHash;
      u.sessionVersion += 1;
      return { ...u };
    });
    return { service, repo, consumirLimite: extra.consumirLimite as jest.Mock, consumirTokenSenha: extra.consumirTokenSenha as jest.Mock };
  }

  it('consome o hash do token (nunca o cru), grava bcrypt e já devolve a sessão; o login seguinte funciona', async () => {
    const { service, repo, consumirTokenSenha } = montarLink();
    const sessao = await service.definirSenha(TOKEN, 'senha-nova-123', '203.0.113.9');
    expect(sessao.accessToken.split('.')).toHaveLength(3);
    const [tokenHash, hash] = consumirTokenSenha.mock.calls[0] as [string, string];
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(TOKEN);
    expect(await bcrypt.compare('senha-nova-123', hash)).toBe(true);
    // a sessão nasce na versão nova (a troca derrubou as antigas)
    expect([...repo.tokens.values()][0].sessionVersion).toBe(1);
    await expect(service.login('corretor@exemplo.com', 'senha-nova-123')).resolves.toHaveProperty('accessToken');
  });

  it('token malformado, vencido, usado ou de conta inativa: o MESMO 400 link_invalido, sem sessão', async () => {
    const { service, repo, consumirTokenSenha } = montarLink({ valido: false });
    for (const t of [TOKEN, 'curto', 'x'.repeat(40) + '!']) {
      await expect(service.definirSenha(t, 'senha-nova-123', '203.0.113.9'))
        .rejects.toMatchObject({ status: 400, response: expect.objectContaining({ codigo: 'link_invalido' }) });
    }
    expect(consumirTokenSenha).toHaveBeenCalledTimes(1); // malformado nem vai ao banco
    expect(repo.tokens.size).toBe(0);
  });

  it('acima do limite por IP: 429 antes do bcrypt e do banco; a chave do IP não é o IP cru', async () => {
    const { service, consumirLimite, consumirTokenSenha } = montarLink({ limite: 1 });
    await service.definirSenha(TOKEN, 'senha-nova-123', '198.51.100.7');
    await expect(service.definirSenha(TOKEN, 'senha-nova-123', '198.51.100.7')).rejects.toMatchObject({ status: 429 });
    expect(consumirTokenSenha).toHaveBeenCalledTimes(1);
    const [escopo, chave] = consumirLimite.mock.calls[0] as [string, string];
    expect(escopo).toBe('auth-definir-senha-ip');
    expect(chave).toMatch(/^[0-9a-f]{64}$/);
    expect(chave).not.toContain('198.51.100.7');
  });

  it('503 sem AUTH_JWT_SECRET, antes de qualquer gravação', async () => {
    const repo = new RepoFake() as unknown as Record<string, unknown>;
    repo.consumirLimite = jest.fn();
    repo.consumirTokenSenha = jest.fn();
    const service = new AuthService({ ...baseEnv, authJwtSecret: undefined }, repo as unknown as UsuariosRepo);
    await expect(service.definirSenha(TOKEN, 'senha-nova-123', null)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.consumirTokenSenha).not.toHaveBeenCalled();
  });
});
