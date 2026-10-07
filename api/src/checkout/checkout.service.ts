import { ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppEnv, ENV } from '../config/env';
import { montarLinkSenha, TTL_LINK_SENHA_S } from '../auth/token-senha';
import { UsuariosRepo } from '../auth/usuarios.repo';
import { PrismaService } from '../prisma/prisma.service';
import { AtualizarPedidoDto, CriarPedidoDto } from './checkout.dto';
import { CheckoutRepo, PagamentoAsaas, PedidoCheckout } from './checkout.repo';

/** Uuid em qualquer versão: id fora do formato não existe (404, não 500 do cast). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Erros de apply_checkout_payment (RAISE EXCEPTION '<CÓDIGO>') e do provisionamento. */
const CODIGOS_DE_NEGOCIO = new Set([
  'PAYMENT_MISMATCH', 'PROFILE_NOT_FOUND', 'PLAN_NOT_FOUND', 'ANOTHER_SUBSCRIPTION_EXISTS',
]);

export interface ResultadoProvisionamento {
  user_id: string;
  corretor_id: string;
  /** true quando a conta nasceu agora (o antigo "convite"). */
  conta_criada: boolean;
  /** true quando o pedido já estava provisionado e só o pagamento foi reaplicado. */
  ja_provisionado: boolean;
  senha_definida: boolean;
  /** `${LOTTI_APP_PASSWORD_SETUP_URL}?token=...` quando a conta ainda não tem senha. */
  link_senha: string | null;
  link_expira_em: string | null;
}

export interface ResultadoLinkSenha {
  senha_definida: boolean;
  link_senha: string | null;
  link_expira_em: string | null;
  /** Tela de entrada da plataforma (mesma origem da página de senha), para quem já tem senha. */
  link_entrar: string;
}

function erro(status: number, codigo: string, message: string): HttpException {
  return new HttpException({ statusCode: status, codigo, message }, status);
}

/** Código de um RAISE EXCEPTION 'CÓDIGO' vindo do Prisma (P2010 com meta.code P0001). */
export function codigoDoBanco(e: unknown): string | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = e.meta as { code?: unknown; message?: unknown } | undefined;
  if (meta?.code !== 'P0001' || typeof meta.message !== 'string') return null;
  const m = /^(?:ERROR:\s*)?([A-Z_]+)\b/.exec(meta.message.split('\n')[0]);
  return m && CODIGOS_DE_NEGOCIO.has(m[1]) ? m[1] : null;
}

/** 23505 (unique_violation) embrulhado pelo Prisma. */
function unicidade(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === 'P2002') return true;
  return e.code === 'P2010' && (e.meta as { code?: unknown } | undefined)?.code === '23505';
}

/** sha256(token) confere com o hash guardado, em tempo constante. */
export function tokenDeStatusConfere(token: string, hashGuardado: string): boolean {
  const atual = createHash('sha256').update(token, 'utf8').digest();
  const esperado = Buffer.from(hashGuardado, 'hex');
  return esperado.length === atual.length && timingSafeEqual(atual, esperado);
}

/** Falha de negócio do provisionamento: vira 409 com o código que o site já conhecia. */
class FalhaDeProvisionamento extends Error {
  constructor(readonly codigo: string) { super(codigo); }
}

/**
 * Checkout do site institucional, servidor a servidor (CheckoutTokenGuard). Cobre o que o site
 * fazia com a Secret Key do Supabase: pedidos, limite por IP, eventos do webhook, aplicação do
 * pagamento e o provisionamento da conta — agora no login próprio (auth.users + usuarios, sem
 * senha) com um link de criar senha no lugar do convite por e-mail.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    private readonly repo: CheckoutRepo,
    private readonly usuarios: UsuariosRepo,
    private readonly prisma: PrismaService,
  ) {}

  /** Sem a página de senha a conta paga ficaria sem acesso: o checkout nem começa. */
  private paginaDeSenha(): string {
    const url = this.env.passwordSetupUrl;
    if (!url) {
      throw new ServiceUnavailableException({
        statusCode: 503, codigo: 'checkout_nao_configurado', message: 'LOTTI_APP_PASSWORD_SETUP_URL não configurada.',
      });
    }
    return url;
  }

  private linkEntrar(base: string): string {
    return new URL('/auth', base).toString();
  }

  async consumirLimite(chave: string): Promise<{ permitido: boolean }> {
    this.paginaDeSenha();
    return { permitido: await this.repo.consumirLimite(chave) };
  }

  async criarPedido(dto: CriarPedidoDto): Promise<{ ok: true }> {
    this.paginaDeSenha();
    try {
      await this.repo.inserirPedido(dto);
    } catch (e) {
      if (unicidade(e)) throw erro(409, 'pedido_existente', 'Pedido repetido: o id ou o token de status já foram usados.');
      throw e;
    }
    return { ok: true };
  }

  async obterPedido(id: string): Promise<PedidoCheckout> {
    const pedido = UUID.test(id) ? await this.repo.obterPedido(id) : null;
    if (!pedido) throw new NotFoundException({ statusCode: 404, codigo: 'pedido_nao_encontrado', message: 'Pedido não encontrado.' });
    return pedido;
  }

  async buscarPorAssinatura(assinatura: string): Promise<PedidoCheckout> {
    const pedido = await this.repo.buscarPorAssinatura(assinatura);
    if (!pedido) throw new NotFoundException({ statusCode: 404, codigo: 'pedido_nao_encontrado', message: 'Pedido não encontrado.' });
    return pedido;
  }

  async atualizarPedido(id: string, dto: AtualizarPedidoDto): Promise<{ ok: true; linhas: number }> {
    if (!UUID.test(id)) return { ok: true, linhas: 0 };
    const campos = {
      status: dto.status, asaas_customer_id: dto.asaas_customer_id, asaas_subscription_id: dto.asaas_subscription_id,
      asaas_payment_id: dto.asaas_payment_id, failure_code: dto.failure_code,
    };
    if (Object.values(campos).every((v) => v === undefined)) return { ok: true, linhas: 0 };
    return { ok: true, linhas: await this.repo.atualizarPedido(id, campos) };
  }

  async reservarEvento(id: string, tipo: string, pagamento: string | null): Promise<{ reservado: boolean }> {
    return { reservado: await this.repo.reservarEvento(id, tipo, pagamento) };
  }

  async concluirEvento(id: string, status: string, erroCodigo: string | null): Promise<{ ok: true }> {
    await this.repo.concluirEvento(id, status, erroCodigo);
    return { ok: true };
  }

  async reservarProvisionamento(id: string): Promise<{ reservado: boolean }> {
    if (!UUID.test(id)) return { reservado: false };
    return { reservado: await this.repo.reservarProvisionamento(id) };
  }

  /**
   * Renovação, atraso, estorno: aplica a cobrança à conta já ligada ao pedido (nunca a uma conta
   * escolhida por quem chama). Sem conta ligada → 409 PROVISIONED_USER_MISSING.
   */
  async aplicarPagamento(id: string, pagamento: PagamentoAsaas): Promise<{ ok: true }> {
    const pedido = await this.obterPedido(id);
    if (!pedido.provisioned_user_id) throw erro(409, 'PROVISIONED_USER_MISSING', 'Pedido sem conta provisionada.');
    try {
      await this.prisma.$transaction((tx) => this.repo.aplicarPagamento(tx, id, pagamento, pedido.provisioned_user_id!));
    } catch (e) {
      const codigo = codigoDoBanco(e);
      if (codigo) throw erro(409, codigo, 'Pagamento não aplicado.');
      throw e;
    }
    return { ok: true };
  }

  /**
   * Conta pelo e-mail: a de login (usuarios/auth.users) ou, se só o e-mail do PERFIL bater, a do
   * corretor com `email_confere: false` (o caso que o provisionamento recusa).
   */
  async buscarConta(email: string): Promise<{ user_id: string; corretor_id: string | null; email_confere: boolean }> {
    const e = email.trim().toLowerCase();
    const conta = await this.repo.contaPorEmailDeLogin(e);
    if (conta) return { user_id: conta.userId, corretor_id: conta.corretorId, email_confere: true };
    const perfil = await this.repo.corretorPorEmailDePerfil(e);
    if (perfil) return { user_id: perfil.userId, corretor_id: perfil.corretorId, email_confere: false };
    throw new NotFoundException({ statusCode: 404, codigo: 'conta_nao_encontrada', message: 'Conta não encontrada.' });
  }

  /**
   * O provisionPaidOrder do site, numa chamada: reserva o pedido (claim_checkout_order_provisioning);
   * numa transação acha ou cria a conta pelo e-mail do pagamento (auth.users + usuarios sem senha,
   * o gatilho cria o corretor), aplica o pagamento (apply_checkout_payment) e marca o pedido
   * provisionado; emite o link de criar senha se a conta não tem senha. Falha → solta a reserva com
   * PROVISIONING_RETRY (o webhook responde 503 e o Asaas reenvia).
   *
   * Idempotente: pedido já provisionado só reaplica o pagamento à mesma conta; o mesmo e-mail em
   * outro pedido reaproveita a conta (e apply_checkout_payment decide se aceita a assinatura).
   */
  async provisionar(id: string, pagamento: PagamentoAsaas): Promise<ResultadoProvisionamento> {
    const base = this.paginaDeSenha();
    const pedido = await this.obterPedido(id);

    if (!(await this.repo.reservarProvisionamento(id))) {
      const atual = (await this.repo.obterPedido(id)) ?? pedido;
      if (atual.access_email_sent_at && atual.provisioned_user_id) return this.reaplicar(atual, pagamento);
      throw erro(409, 'PROVISIONING_BUSY', 'Provisionamento em andamento para este pedido.');
    }

    try {
      const r = await this.prisma.$transaction(async (tx) => {
        const conta = await this.acharOuCriarConta(tx, pedido);
        await this.repo.aplicarPagamento(tx, id, pagamento, conta.userId);
        await this.repo.marcarProvisionado(tx, id, conta.userId);
        const link = conta.temSenha ? null : await this.usuarios.emitirTokenSenha(
          { userId: conta.userId, finalidade: 'definir_senha', ttlSegundos: TTL_LINK_SENHA_S, pedidoId: id }, tx,
        );
        return { conta, link };
      });
      return {
        user_id: r.conta.userId,
        corretor_id: r.conta.corretorId,
        conta_criada: r.conta.criada,
        ja_provisionado: false,
        senha_definida: r.conta.temSenha,
        link_senha: r.link ? montarLinkSenha(base, r.link.token) : null,
        link_expira_em: r.link ? r.link.expiraEm.toISOString() : null,
      };
    } catch (e) {
      await this.repo.liberarProvisionamento(id).catch(() => undefined);
      if (e instanceof FalhaDeProvisionamento) throw erro(409, e.codigo, 'Não foi possível provisionar a conta.');
      const codigo = codigoDoBanco(e);
      if (codigo) throw erro(409, codigo, 'Pagamento não aplicado.');
      throw e;
    }
  }

  /** Pedido já provisionado (reentrega do webhook): só a cobrança, na conta já ligada. */
  private async reaplicar(pedido: PedidoCheckout, pagamento: PagamentoAsaas): Promise<ResultadoProvisionamento> {
    const userId = pedido.provisioned_user_id!;
    try {
      await this.prisma.$transaction((tx) => this.repo.aplicarPagamento(tx, pedido.id, pagamento, userId));
    } catch (e) {
      const codigo = codigoDoBanco(e);
      if (codigo) throw erro(409, codigo, 'Pagamento não aplicado.');
      throw e;
    }
    const conta = await this.usuarios.buscarPorId(userId);
    const corretorId = await this.repo.corretorIdDoUsuario(userId);
    if (!corretorId) throw erro(409, 'PROFILE_NOT_FOUND', 'Pagamento não aplicado.');
    return {
      user_id: userId,
      corretor_id: corretorId,
      conta_criada: false,
      ja_provisionado: true,
      senha_definida: Boolean(conta?.passwordHash),
      link_senha: null,
      link_expira_em: null,
    };
  }

  /**
   * Regra do inviteOrFindUser do site, com o e-mail de LOGIN como identidade:
   *  - conta com esse e-mail de login → ela (o corretor vem pelo user_id);
   *  - só um corretor com esse e-mail de perfil (o login é outro) → ACCOUNT_EMAIL_MISMATCH;
   *  - nenhuma → cria auth.users + usuarios sem senha (o gatilho cria o corretor).
   * Travado por e-mail: dois pedidos do mesmo e-mail ao mesmo tempo não criam duas contas.
   */
  private async acharOuCriarConta(tx: Prisma.TransactionClient, pedido: PedidoCheckout): Promise<{
    userId: string; corretorId: string; criada: boolean; temSenha: boolean;
  }> {
    const email = pedido.payer_email.trim().toLowerCase();
    await this.repo.travarEmail(tx, email);

    const existente = await this.repo.contaPorEmailDeLogin(email, tx);
    if (existente) {
      if (!existente.corretorId) throw new FalhaDeProvisionamento('PROVISION_PROFILE_CREATE_FAILED');
      let temSenha = existente.temSenha;
      if (!existente.temUsuario) {
        // Conta antiga ainda sem a linha do login próprio: cria agora, com o bcrypt de auth.users.
        await this.repo.garantirUsuario(tx, existente.userId);
        temSenha = (await this.repo.contaPorEmailDeLogin(email, tx))?.temSenha ?? false;
      }
      return { userId: existente.userId, corretorId: existente.corretorId, criada: false, temSenha };
    }

    if (await this.repo.corretorPorEmailDePerfil(email, tx)) throw new FalhaDeProvisionamento('ACCOUNT_EMAIL_MISMATCH');

    const nova = await this.usuarios.criarContaEm(tx, {
      email,
      passwordHash: null,
      nome: pedido.payer_name.trim(),
      cnpj: pedido.payer_document,
      telefone: pedido.payer_phone,
      origem: 'checkout_asaas',
      convite: true,
    });
    if (!nova) throw new FalhaDeProvisionamento('PROVISION_INVITE_FAILED');
    const corretorId = await this.repo.corretorIdDoUsuario(nova.id, tx);
    if (!corretorId) throw new FalhaDeProvisionamento('PROVISION_PROFILE_CREATE_FAILED');
    return { userId: nova.id, corretorId, criada: true, temSenha: false };
  }

  /**
   * Link de criar senha para a tela de sucesso do site. A API refaz a conferência do token de
   * status (o mesmo do navegador que pagou), exige o pedido ativo e provisionado, e só emite link
   * para conta sem senha; conta com senha recebe o link de entrar. Cada chamada emite um link novo
   * (o banco só tem o hash); os anteriores seguem válidos até o primeiro uso, que derruba todos.
   */
  async linkSenha(id: string, tokenStatus: string): Promise<ResultadoLinkSenha> {
    const base = this.paginaDeSenha();
    const pedido = UUID.test(id) ? await this.repo.obterPedido(id) : null;
    if (!pedido || !tokenDeStatusConfere(tokenStatus, pedido.access_token_hash)) {
      throw new NotFoundException({ statusCode: 404, codigo: 'pedido_nao_encontrado', message: 'Pedido não encontrado.' });
    }
    if (pedido.status !== 'active' || !pedido.provisioned_user_id || !pedido.access_email_sent_at) {
      throw new ConflictException({ statusCode: 409, codigo: 'pedido_nao_provisionado', message: 'O acesso deste pedido ainda não foi liberado.' });
    }
    const usuario = await this.usuarios.buscarPorId(pedido.provisioned_user_id);
    if (!usuario || usuario.status !== 'ativo') {
      throw new ConflictException({ statusCode: 409, codigo: 'conta_indisponivel', message: 'A conta deste pedido não está ativa.' });
    }
    const entrar = this.linkEntrar(base);
    if (usuario.passwordHash) return { senha_definida: true, link_senha: null, link_expira_em: null, link_entrar: entrar };
    const { token, expiraEm } = await this.usuarios.emitirTokenSenha({
      userId: usuario.id, finalidade: 'definir_senha', ttlSegundos: TTL_LINK_SENHA_S, pedidoId: pedido.id,
    });
    return { senha_definida: false, link_senha: montarLinkSenha(base, token), link_expira_em: expiraEm.toISOString(), link_entrar: entrar };
  }
}
