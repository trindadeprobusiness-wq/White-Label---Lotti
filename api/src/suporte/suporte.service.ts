import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CLAIM_SUPORTE, emitirTokenSuporte } from '../auth/token-suporte';
import { AppEnv, ENV } from '../config/env';
import { erroApi, erroPg } from '../parceiros/parceiros.erros';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { AbrirSuporteDto } from './suporte.dto';

/** O motivo que suporte_criar_sessao() grava hoje na abertura. */
const MOTIVO_PADRAO = 'Atendimento pelo backoffice';

/** O `user` que a Edge devolvia (o front usa como usuário efetivo durante o atendimento). */
export interface UsuarioAtendido {
  id: string;
  email: string;
  aud: 'authenticated';
  role: 'authenticated';
  app_metadata: Record<string, never>;
  user_metadata: Record<string, unknown>;
  created_at: string | null;
}

/** Mesmo corpo da Edge `admin-suporte` (acao 'abrir'), mais o token de atendimento. */
export interface SessaoSuporteAberta {
  id: string;
  corretor_id: string;
  nome: string;
  expira_em: string;
  user: UsuarioAtendido;
  /** Token curto da API (sub = titular), válido só enquanto a sessão estiver ativa. Sem refresh. */
  token: string;
}

interface Alvo {
  corretor_id: string;
  user_id: string;
  nome: string;
}

export const ERROS_SUPORTE = {
  contaInvalida: () => erroApi(400, 'conta_invalida', 'Conta inválida.'),
  semPermissao: () => erroApi(403, 'sem_permissao', 'Acesso negado.'),
  contaInativa: () => erroApi(403, 'conta_inativa', 'A conta precisa estar ativa para iniciar atendimento.'),
  contaAdministrativa: () =>
    erroApi(403, 'conta_administrativa', 'Contas administrativas não podem ser abertas em modo de atendimento.'),
  contaIndisponivel: () => erroApi(403, 'conta_indisponivel', 'Conta indisponível para atendimento.'),
  emailNaoConfirmado: () => erroApi(409, 'email_nao_confirmado', 'A conta ainda precisa confirmar o e-mail.'),
  duasEtapas: () => erroApi(409, 'conta_com_duas_etapas',
    'Esta conta usa autenticação em duas etapas e exige atendimento acompanhado pelo titular.'),
  indisponivel: () => erroApi(503, 'suporte_indisponivel', 'Atendimento indisponível no momento.'),
  naoEncerrou: () => erroApi(403, 'atendimento_nao_encerrado', 'Não foi possível encerrar o atendimento.'),
};

/** Erros de admin_preparar_suporte() (todos 42501), com o texto que a Edge repassava. */
function traduzirPreparo(e: unknown): unknown {
  const pg = erroPg(e);
  if (!pg || pg.sqlstate !== '42501') return e;
  if (pg.mensagem.startsWith('A conta precisa estar ativa')) return ERROS_SUPORTE.contaInativa();
  if (pg.mensagem.startsWith('Contas administrativas')) return ERROS_SUPORTE.contaAdministrativa();
  return ERROS_SUPORTE.semPermissao();
}

/**
 * Atendimento do backoffice pela API, no lugar da Edge `admin-suporte`.
 *
 * Abrir segue os mesmos passos e checagens da Edge: admin_preparar_suporte() no caminho do
 * ADMINISTRADOR (is_admin(), conta ativa, titular não-administrador), e-mail confirmado e sem
 * duas etapas; depois, na conexão dona e numa transação, as checagens de suporte_criar_sessao()
 * de novo (ator com papel, conta ativa travada FOR SHARE, titular sem papel), a linha de
 * admin_sessoes_suporte (30 min, o default da tabela) e a auditoria `suporte_aberto` com o mesmo
 * conteúdo. O que some: o magic link do Supabase, a checagem de auth.sessions e o JWT do titular
 * em suporte_privado.credenciais — no lugar deles vai um token curto assinado pela API, cujo
 * `session_id` é o auth_session_id gerado aqui (o que auditar_mutacao_suporte() procura).
 *
 * Encerrar chama a própria suporte_encerrar_sessao() (só o ator da sessão; idempotente; auditoria
 * `suporte_encerrado`). O token morre junto: o guard confere a sessão a cada requisição.
 */
@Injectable()
export class SuporteService {
  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  async abrir(claims: SupabaseClaims, dto: AbrirSuporteDto): Promise<SessaoSuporteAberta> {
    // O guard já recusa o token de atendimento nesta rota; aqui é a segunda trava.
    if (claims[CLAIM_SUPORTE] !== undefined) throw ERROS_SUPORTE.semPermissao();
    const segredo = this.env.authJwtSecret;
    if (!segredo) throw ERROS_SUPORTE.indisponivel();
    if (!dto.corretor_id === !dto.usuario_id) throw ERROS_SUPORTE.contaInvalida();

    const pedido = dto.corretor_id ?? (await this.corretorDoUsuario(dto.usuario_id as string));
    const alvo = await this.preparar(claims, pedido);
    const usuario = await this.usuarioAtendido(alvo.user_id);
    if (!usuario?.email || !usuario.email_confirmed_at) throw ERROS_SUPORTE.emailNaoConfirmado();
    const email = usuario.email;
    if (await this.usaDuasEtapas(alvo.user_id)) throw ERROS_SUPORTE.duasEtapas();
    const motivo = dto.motivo?.trim() || MOTIVO_PADRAO;

    return this.prisma.$transaction(async (tx) => {
      const ator = await tx.$queryRaw<Array<{ ok: boolean }>>(Prisma.sql`
        select exists (select 1 from public.user_roles
                        where user_id = ${claims.sub}::uuid and role in ('admin', 'super_admin')
                          and revogado_em is null) as ok`);
      if (ator[0]?.ok !== true) throw ERROS_SUPORTE.semPermissao();

      const conta = await tx.$queryRaw<Array<{ user_id: string }>>(Prisma.sql`
        select c.user_id::text as user_id
          from public.corretores c
         where c.id = ${alvo.corretor_id}::uuid and c.status = 'ativo'
           and not exists (select 1 from public.user_roles r
                            where r.user_id = c.user_id and r.role in ('admin', 'super_admin') and r.revogado_em is null)
           for share of c`);
      if (conta[0]?.user_id !== alvo.user_id) throw ERROS_SUPORTE.contaIndisponivel();

      const sessoes = await tx.$queryRaw<Array<{ id: string; corretor_id: string; auth_session_id: string; expira_em: Date }>>(Prisma.sql`
        with s as (
          insert into public.admin_sessoes_suporte (ator_user_id, user_id, corretor_id, auth_session_id)
          values (${claims.sub}::uuid, ${alvo.user_id}::uuid, ${alvo.corretor_id}::uuid, gen_random_uuid())
          returning *
        ), auditoria as (
          insert into public.admin_auditoria (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
          select s.ator_user_id, 'suporte_aberto', 'corretores', s.corretor_id::text,
                 jsonb_build_object('sessao_id', s.id, 'expira_em', s.expira_em), ${motivo}::text
            from s
          returning id
        )
        select s.id::text as id, s.corretor_id::text as corretor_id, s.auth_session_id::text as auth_session_id, s.expira_em
          from s`);
      const s = sessoes[0];
      // Assinado dentro da transação: se falhar, a sessão e a auditoria não ficam para trás.
      const { token } = await emitirTokenSuporte(
        {
          sub: alvo.user_id, email, sessaoId: s.id, authSessionId: s.auth_session_id,
          atorUserId: claims.sub, expiraEm: s.expira_em,
        },
        { segredo, issuer: this.env.authIssuer },
      );
      return {
        id: s.id,
        corretor_id: s.corretor_id,
        nome: alvo.nome,
        expira_em: s.expira_em.toISOString(),
        user: {
          id: usuario.id,
          email,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: usuario.user_metadata ?? {},
          created_at: usuario.created_at ? usuario.created_at.toISOString() : null,
        },
        token,
      };
    });
  }

  async encerrar(claims: SupabaseClaims, sessaoId: string): Promise<{ ok: true }> {
    if (claims[CLAIM_SUPORTE] !== undefined) throw ERROS_SUPORTE.naoEncerrou();
    try {
      // $executeRaw: a função devolve o JWT guardado pela Edge (se a sessão veio de lá); ele nem
      // chega à API.
      await this.prisma.$executeRaw(Prisma.sql`
        select public.suporte_encerrar_sessao(${sessaoId}::uuid, ${claims.sub}::uuid)`);
    } catch (e) {
      if (erroPg(e)?.sqlstate === '42501') throw ERROS_SUPORTE.naoEncerrou();
      throw e;
    }
    return { ok: true };
  }

  /** usuario_id → corretor. Sem corretor, segue null: a função do banco responde (sem revelar nada a quem não é admin). */
  private async corretorDoUsuario(usuarioId: string): Promise<string | null> {
    const r = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id::text as id from public.corretores where user_id = ${usuarioId}::uuid`);
    return r[0]?.id ?? null;
  }

  /** admin_preparar_suporte() como o administrador (RLS e is_admin() do jeito de hoje). */
  private async preparar(claims: SupabaseClaims, corretorId: string | null): Promise<Alvo> {
    try {
      return await this.db.run(claims, async (tx) => {
        const r = await tx.$queryRaw<Array<{ alvo: Alvo }>>(Prisma.sql`
          select public.admin_preparar_suporte(${corretorId}::uuid) as alvo`);
        return r[0].alvo;
      });
    } catch (e) {
      throw traduzirPreparo(e);
    }
  }

  private async usuarioAtendido(userId: string): Promise<{
    id: string; email: string | null; email_confirmed_at: Date | null;
    user_metadata: Record<string, unknown> | null; created_at: Date | null;
  } | undefined> {
    const r = await this.prisma.$queryRaw<Array<{
      id: string; email: string | null; email_confirmed_at: Date | null;
      user_metadata: Record<string, unknown> | null; created_at: Date | null;
    }>>(Prisma.sql`
      select u.id::text as id, u.email::text as email, u.email_confirmed_at,
             u.raw_user_meta_data as user_metadata, u.created_at
        from auth.users u where u.id = ${userId}::uuid`);
    return r[0];
  }

  /**
   * Fator de duas etapas verificado → só atendimento acompanhado (regra da Edge). A tabela do
   * Supabase Auth não existe no banco da API (o login próprio não tem MFA); onde existir, vale.
   */
  private async usaDuasEtapas(userId: string): Promise<boolean> {
    const tabela = await this.prisma.$queryRaw<Array<{ existe: boolean }>>(Prisma.sql`
      select to_regclass('auth.mfa_factors') is not null as existe`);
    if (tabela[0]?.existe !== true) return false;
    const r = await this.prisma.$queryRaw<Array<{ tem: boolean }>>(Prisma.sql`
      select exists (select 1 from auth.mfa_factors f
                      where f.user_id = ${userId}::uuid and f.status::text = 'verified') as tem`);
    return r[0]?.tem === true;
  }
}
