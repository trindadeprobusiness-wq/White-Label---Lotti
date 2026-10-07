import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FinalidadeTokenSenha, gerarTokenSenha } from './token-senha';

/**
 * Acesso às tabelas do login próprio (public.usuarios e public.auth_refresh_tokens).
 *
 * Roda na conexão base da API (dona das tabelas), FORA do contexto de tenant: o
 * login acontece antes de existir qualquer claim, então nada de TenantDb aqui. As
 * tabelas têm RLS habilitada sem policy pública; o dono passa por cima, e nenhum
 * papel `authenticated`/`anon` enxerga uma linha.
 *
 * Nunca devolve nem registra o password_hash cru em log; o hash sai apenas no
 * campo tipado de `buscarPorEmail` para o bcrypt.compare do serviço.
 */
export interface UsuarioAuth {
  id: string;
  email: string;
  passwordHash: string | null;
  status: string;
  sessionVersion: number;
}

export interface RefreshTokenGravado {
  id: string;
  userId: string;
  familyId: string;
  sessionVersion: number;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

@Injectable()
export class UsuariosRepo {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Prisma.TransactionClient {
    return this.prisma as unknown as Prisma.TransactionClient;
  }

  /** Conta pelo e-mail normalizado (lower/trim). Null quando não existe. */
  async buscarPorEmail(email: string): Promise<UsuarioAuth | null> {
    const linhas = await this.db.$queryRaw<Array<{
      id: string; email: string; password_hash: string | null; status: string; session_version: number;
    }>>`
      select id::text as id, email, password_hash, status, session_version
      from public.usuarios
      where lower(btrim(email)) = lower(btrim(${email}::text))
      limit 1
    `;
    const u = linhas[0];
    if (!u) return null;
    return { id: u.id, email: u.email, passwordHash: u.password_hash, status: u.status, sessionVersion: Number(u.session_version) };
  }

  /** Conta pelo id (auth.users.id preservado). Null quando não existe. */
  async buscarPorId(userId: string): Promise<UsuarioAuth | null> {
    const linhas = await this.db.$queryRaw<Array<{
      id: string; email: string; password_hash: string | null; status: string; session_version: number;
    }>>`
      select id::text as id, email, password_hash, status, session_version
      from public.usuarios
      where id = ${userId}::uuid
      limit 1
    `;
    const u = linhas[0];
    if (!u) return null;
    return { id: u.id, email: u.email, passwordHash: u.password_hash, status: u.status, sessionVersion: Number(u.session_version) };
  }

  /** Lê a versão de sessão atual (usada no /refresh para invalidar sessões antigas). */
  async sessionVersion(userId: string): Promise<number | null> {
    const linhas = await this.db.$queryRaw<Array<{ session_version: number }>>`
      select session_version from public.usuarios where id = ${userId}::uuid limit 1
    `;
    return linhas[0] ? Number(linhas[0].session_version) : null;
  }

  /** Grava o hash do refresh (SHA-256), nunca o token cru. Devolve o id da linha. */
  async inserirRefreshToken(dados: {
    userId: string; familyId: string; tokenHash: string; sessionVersion: number; expiresAt: Date;
  }): Promise<string> {
    const linhas = await this.db.$queryRaw<Array<{ id: string }>>`
      insert into public.auth_refresh_tokens (user_id, family_id, token_hash, session_version, expires_at)
      values (${dados.userId}::uuid, ${dados.familyId}::uuid, ${dados.tokenHash}::text, ${dados.sessionVersion}::int, ${dados.expiresAt}::timestamptz)
      returning id::text as id
    `;
    return linhas[0].id;
  }

  /** Procura um refresh pelo hash. Null quando não existe. */
  async buscarRefreshPorHash(tokenHash: string): Promise<RefreshTokenGravado | null> {
    const linhas = await this.db.$queryRaw<Array<{
      id: string; user_id: string; family_id: string; session_version: number;
      expires_at: Date; used_at: Date | null; revoked_at: Date | null;
    }>>`
      select id::text as id, user_id::text as user_id, family_id::text as family_id, session_version,
             expires_at, used_at, revoked_at
      from public.auth_refresh_tokens
      where token_hash = ${tokenHash}::text
      limit 1
    `;
    const r = linhas[0];
    if (!r) return null;
    return {
      id: r.id, userId: r.user_id, familyId: r.family_id, sessionVersion: Number(r.session_version),
      expiresAt: r.expires_at, usedAt: r.used_at, revokedAt: r.revoked_at,
    };
  }

  /** Marca um refresh como usado (rotação). Devolve quantas linhas mudaram (1 se ainda não usado). */
  async marcarUsado(id: string): Promise<number> {
    return this.db.$executeRaw`
      update public.auth_refresh_tokens set used_at = now()
      where id = ${id}::uuid and used_at is null
    `;
  }

  /** Revoga a família inteira (logout ou detecção de reuso). Idempotente. */
  async revogarFamilia(familyId: string): Promise<number> {
    return this.db.$executeRaw`
      update public.auth_refresh_tokens set revoked_at = now()
      where family_id = ${familyId}::uuid and revoked_at is null
    `;
  }

  /**
   * Cadastro numa transação só, como dono do banco (fora do TenantDb: ainda não há claims).
   *
   * auth.users primeiro: o gatilho on_auth_user_created (handle_new_user) cria o corretor, e os
   * gatilhos do corretor criam organização, onboarding e etapas do funil — o mesmo caminho de quem
   * se cadastrava pelo Supabase. Depois public.usuarios com o MESMO id e o mesmo bcrypt, para o
   * login próprio achar a conta. Qualquer falha desfaz as duas.
   *
   * Null quando o e-mail já tem conta (em qualquer das tabelas, ou na corrida pelo índice único).
   * O e-mail chega normalizado (lower/trim) do serviço.
   */
  async criarConta(dados: NovaConta): Promise<UsuarioAuth | null> {
    try {
      return await this.prisma.$transaction((tx) => this.criarContaEm(tx, dados));
    } catch (e) {
      if (violacaoDeUnicidade(e)) return null;
      throw e;
    }
  }

  /**
   * O mesmo cadastro dentro de uma transação já aberta: o checkout cria a conta, aplica o
   * pagamento e marca o pedido numa transação só. Null quando o e-mail já tem conta. Aqui uma
   * violação de unicidade (corrida) sobe como veio: a transação de quem chamou já está perdida.
   */
  async criarContaEm(tx: Prisma.TransactionClient, dados: NovaConta): Promise<UsuarioAuth | null> {
    const id = randomUUID();
    const app = JSON.stringify({ provider: 'email', providers: ['email'] });
    // Mesmo raw_user_meta_data que o signUp do front mandava ao Supabase (creci legado NOT NULL);
    // o checkout acrescenta a origem, como o convite do site fazia.
    const meta = JSON.stringify({
      nome: dados.nome, cnpj: dados.cnpj, creci: 'PENDENTE', telefone: dados.telefone,
      ...(dados.origem ? { origem: dados.origem } : {}),
    });
    const convite = dados.convite === true;
    const existe = await tx.$queryRaw<Array<{ existe: boolean }>>`
      select exists (select 1 from public.usuarios where lower(btrim(email)) = ${dados.email}::text)
          or exists (select 1 from auth.users where lower(btrim(email)) = ${dados.email}::text) as existe
    `;
    if (existe[0]?.existe) return null;
    await tx.$executeRaw`
      insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, invited_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values (${id}::uuid, 'authenticated', 'authenticated', ${dados.email}::text, ${dados.passwordHash}::text, now(),
              case when ${convite}::boolean then now() end,
              ${app}::jsonb, ${meta}::jsonb, now(), now())
    `;
    await tx.$executeRaw`
      insert into public.usuarios (id, email, password_hash)
      values (${id}::uuid, ${dados.email}::text, ${dados.passwordHash}::text)
    `;
    const corretor = await tx.$queryRaw<Array<{ id: string }>>`
      select id::text as id from public.corretores where user_id = ${id}::uuid limit 1
    `;
    // Sem corretor a conta entraria num app vazio e quebrado: desfaz tudo.
    if (corretor.length === 0) throw new Error('cadastro_sem_corretor');
    return { id, email: dados.email, passwordHash: dados.passwordHash, status: 'ativo', sessionVersion: 0 };
  }

  /**
   * Link de senha de uso único: grava só o SHA-256 (o cru volta para quem monta o link) e
   * aproveita para apagar os vencidos/usados do mesmo usuário. `tx` opcional: o checkout emite
   * dentro da transação do provisionamento.
   */
  async emitirTokenSenha(
    dados: { userId: string; finalidade: FinalidadeTokenSenha; ttlSegundos: number; pedidoId?: string | null },
    tx: Prisma.TransactionClient = this.db,
  ): Promise<{ token: string; expiraEm: Date }> {
    const { bruto, hash } = gerarTokenSenha();
    const expiraEm = new Date(Date.now() + dados.ttlSegundos * 1000);
    await tx.$executeRaw`
      delete from public.auth_password_tokens
      where user_id = ${dados.userId}::uuid and (used_at is not null or expires_at <= now())
    `;
    await tx.$executeRaw`
      insert into public.auth_password_tokens (user_id, token_hash, finalidade, checkout_order_id, expires_at)
      values (${dados.userId}::uuid, ${hash}::text, ${dados.finalidade}::text, ${dados.pedidoId ?? null}::uuid, ${expiraEm}::timestamptz)
    `;
    return { token: bruto, expiraEm };
  }

  /**
   * Consome um link de senha e grava o bcrypt, numa transação: trava a conta (dois links do
   * mesmo usuário ao mesmo tempo não gravam duas senhas), marca o token usado (só se aberto,
   * dentro da validade e — para 'definir_senha' — se a conta ainda não tem senha), grava o hash
   * em usuarios E auth.users (como o cadastro), incrementa session_version, revoga os refresh
   * tokens e invalida os outros links abertos. Null para token inexistente, usado, vencido ou
   * conta que não está ativa: quem chama responde sempre o mesmo erro genérico.
   */
  async consumirTokenSenha(tokenHash: string, passwordHash: string): Promise<UsuarioAuth | null> {
    return this.prisma.$transaction(async (tx) => {
      const alvo = await tx.$queryRaw<Array<{ user_id: string }>>`
        select user_id::text as user_id from public.auth_password_tokens where token_hash = ${tokenHash}::text limit 1
      `;
      const userId = alvo[0]?.user_id;
      if (!userId) return null;
      const contas = await tx.$queryRaw<Array<{ status: string; tem_senha: boolean }>>`
        select status, password_hash is not null as tem_senha from public.usuarios where id = ${userId}::uuid for update
      `;
      const conta = contas[0];
      if (!conta || conta.status !== 'ativo') return null;
      const consumido = await tx.$executeRaw`
        update public.auth_password_tokens set used_at = now()
        where token_hash = ${tokenHash}::text and used_at is null and expires_at > now()
          and (finalidade <> 'definir_senha' or not ${conta.tem_senha}::boolean)
      `;
      if (consumido !== 1) return null;
      const linhas = await tx.$queryRaw<Array<{ id: string; email: string; status: string; session_version: number }>>`
        update public.usuarios
           set password_hash = ${passwordHash}::text, session_version = session_version + 1, updated_at = now()
         where id = ${userId}::uuid
        returning id::text as id, email, status, session_version
      `;
      await tx.$executeRaw`
        update auth.users set encrypted_password = ${passwordHash}::text, updated_at = now() where id = ${userId}::uuid
      `;
      await tx.$executeRaw`
        update public.auth_refresh_tokens set revoked_at = now() where user_id = ${userId}::uuid and revoked_at is null
      `;
      await tx.$executeRaw`
        update public.auth_password_tokens set used_at = now() where user_id = ${userId}::uuid and used_at is null
      `;
      const u = linhas[0];
      return { id: u.id, email: u.email, passwordHash, status: u.status, sessionVersion: Number(u.session_version) };
    });
  }

  /**
   * Limite público por chave (public.consume_public_request_limit, o mesmo da captura de lead).
   * Fora de transação, de propósito: a tentativa conta mesmo quando o cadastro falha depois.
   */
  async consumirLimite(escopo: string, chave: string, limite: number, segundos: number): Promise<boolean> {
    const r = await this.db.$queryRaw<Array<{ ok: boolean | null }>>`
      select public.consume_public_request_limit(${escopo}::text, ${chave}::text, ${limite}::int, ${segundos}::int) as ok
    `;
    return r[0]?.ok === true;
  }
}

export interface NovaConta {
  /** Já normalizado (lower/trim). */
  email: string;
  /** bcrypt da senha. Null = conta sem senha (checkout): a senha vem pelo link de definir senha. */
  passwordHash: string | null;
  nome: string;
  cnpj: string;
  telefone: string;
  /** Vai para raw_user_meta_data.origem (ex.: 'checkout_asaas'). Omitido: o meta do cadastro de sempre. */
  origem?: string;
  /** Conta convidada (checkout): grava auth.users.invited_at, como o inviteUserByEmail fazia. */
  convite?: boolean;
}

/** 23505 (unique_violation) embrulhado pelo Prisma: dois cadastros do mesmo e-mail ao mesmo tempo. */
function violacaoDeUnicidade(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === 'P2002') return true;
  return e.code === 'P2010' && (e.meta as { code?: unknown } | undefined)?.code === '23505';
}
