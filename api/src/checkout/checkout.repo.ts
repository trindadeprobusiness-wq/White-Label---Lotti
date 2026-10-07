import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SQL do checkout do site, na conexão da API (dona do banco), como a Secret Key do Supabase
 * fazia: as tabelas checkout_* não têm policy pública e as RPCs são as mesmas da baseline.
 */

/** Uma linha de public.checkout_orders como o PostgREST devolvia (to_jsonb: amount número, datas ISO). */
export interface PedidoCheckout {
  id: string;
  access_token_hash: string;
  payer_name: string;
  payer_email: string;
  payer_document: string;
  payer_phone: string;
  plan_code: string;
  billing_cycle: string;
  payment_method: string;
  amount: number;
  status: string;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  asaas_payment_id: string | null;
  provisioned_user_id: string | null;
  access_email_sent_at: string | null;
  provisioning_started_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface NovoPedido {
  id: string;
  access_token_hash: string;
  payer_name: string;
  payer_email: string;
  payer_document: string;
  payer_phone: string;
  plan_code: string;
  billing_cycle: string;
  payment_method: string;
  amount: number;
}

/** Campos que o site atualiza. undefined = não mexe; failure_code null = limpa. */
export interface CamposPedido {
  status?: string;
  asaas_customer_id?: string;
  asaas_subscription_id?: string;
  asaas_payment_id?: string;
  failure_code?: string | null;
}

export interface PagamentoAsaas {
  payment_id: string;
  customer: string;
  subscription?: string | null;
  status: string;
  due_date: string;
  amount: number;
}

/** Conta achada pelo e-mail de login (usuarios, depois auth.users), com o corretor dela. */
export interface ContaPorEmail {
  userId: string;
  corretorId: string | null;
  /** Já tem linha em public.usuarios (o login próprio a acha). */
  temUsuario: boolean;
  temSenha: boolean;
}

/** Estados que o site não pode desfazer (vêm de apply_checkout_payment). */
const TERMINAIS = ['active', 'overdue', 'refunded'];

@Injectable()
export class CheckoutRepo {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Prisma.TransactionClient {
    return this.prisma as unknown as Prisma.TransactionClient;
  }

  /** consume_checkout_rate_limit: 10 tentativas por chave por minuto. Fora de transação. */
  async consumirLimite(chave: string): Promise<boolean> {
    const r = await this.db.$queryRaw<Array<{ ok: boolean | null }>>`
      select public.consume_checkout_rate_limit(${chave}::text) as ok
    `;
    return r[0]?.ok === true;
  }

  async inserirPedido(p: NovoPedido): Promise<void> {
    await this.db.$executeRaw`
      insert into public.checkout_orders (id, access_token_hash, payer_name, payer_email, payer_document, payer_phone,
                                          plan_code, billing_cycle, payment_method, amount, status)
      values (${p.id}::uuid, ${p.access_token_hash}::text, ${p.payer_name}::text, ${p.payer_email}::text,
              ${p.payer_document}::text, ${p.payer_phone}::text, ${p.plan_code}::text, ${p.billing_cycle}::text,
              ${p.payment_method}::text, ${p.amount}::numeric, 'creating')
    `;
  }

  async obterPedido(id: string, tx: Prisma.TransactionClient = this.db): Promise<PedidoCheckout | null> {
    const r = await tx.$queryRaw<Array<{ pedido: PedidoCheckout }>>`
      select to_jsonb(o) as pedido from public.checkout_orders o where o.id = ${id}::uuid
    `;
    return r[0]?.pedido ?? null;
  }

  async buscarPorAssinatura(assinatura: string): Promise<PedidoCheckout | null> {
    const r = await this.db.$queryRaw<Array<{ pedido: PedidoCheckout }>>`
      select to_jsonb(o) as pedido from public.checkout_orders o where o.asaas_subscription_id = ${assinatura}::text limit 1
    `;
    return r[0]?.pedido ?? null;
  }

  /**
   * Mesmo update do site: só as colunas enviadas; mudar o status para um dos estados do site não
   * passa por cima de active/overdue/refunded (o `.not('status','in',...)` do supabase-js).
   * Devolve quantas linhas mudaram.
   */
  async atualizarPedido(id: string, c: CamposPedido): Promise<number> {
    const tem = (v: unknown) => v !== undefined;
    return this.db.$executeRaw`
      update public.checkout_orders set
        status = case when ${tem(c.status)}::boolean then ${c.status ?? null}::text else status end,
        asaas_customer_id = case when ${tem(c.asaas_customer_id)}::boolean then ${c.asaas_customer_id ?? null}::text else asaas_customer_id end,
        asaas_subscription_id = case when ${tem(c.asaas_subscription_id)}::boolean then ${c.asaas_subscription_id ?? null}::text else asaas_subscription_id end,
        asaas_payment_id = case when ${tem(c.asaas_payment_id)}::boolean then ${c.asaas_payment_id ?? null}::text else asaas_payment_id end,
        failure_code = case when ${tem(c.failure_code)}::boolean then ${c.failure_code ?? null}::text else failure_code end
      where id = ${id}::uuid
        and (not ${tem(c.status)}::boolean or status <> all (${TERMINAIS}::text[]))
    `;
  }

  async reservarEvento(id: string, tipo: string, pagamento: string | null): Promise<boolean> {
    const r = await this.db.$queryRaw<Array<{ ok: boolean | null }>>`
      select public.claim_asaas_checkout_event(${id}::text, ${tipo}::text, ${pagamento}::text) as ok
    `;
    return r[0]?.ok === true;
  }

  /** finish_asaas_checkout_event devolve void: $executeRaw (o $queryRaw não desserializa void). */
  async concluirEvento(id: string, status: string, erro: string | null): Promise<void> {
    await this.db.$executeRaw`
      select public.finish_asaas_checkout_event(${id}::text, ${status}::text, ${erro}::text)
    `;
  }

  async reservarProvisionamento(id: string): Promise<boolean> {
    const r = await this.db.$queryRaw<Array<{ ok: boolean | null }>>`
      select public.claim_checkout_order_provisioning(${id}::uuid) as ok
    `;
    return r[0]?.ok === true;
  }

  /** O catch do provisionPaidOrder do site: solta a reserva e marca para nova tentativa. */
  async liberarProvisionamento(id: string): Promise<void> {
    await this.db.$executeRaw`
      update public.checkout_orders set provisioning_started_at = null, failure_code = 'PROVISIONING_RETRY'
      where id = ${id}::uuid
    `;
  }

  /** apply_checkout_payment (void): erros sobem como P0001 'PAYMENT_MISMATCH', 'PROFILE_NOT_FOUND'... */
  async aplicarPagamento(tx: Prisma.TransactionClient, pedidoId: string, p: PagamentoAsaas, userId: string): Promise<void> {
    await tx.$executeRaw`
      select public.apply_checkout_payment(${pedidoId}::uuid, ${p.payment_id}::text, ${p.customer}::text,
        ${p.subscription ?? null}::text, ${p.status}::text, ${p.due_date}::date, ${p.amount}::numeric, ${userId}::uuid)
    `;
  }

  /** O updateCheckoutOrder final do provisionPaidOrder: pedido ligado à conta e acesso entregue. */
  async marcarProvisionado(tx: Prisma.TransactionClient, pedidoId: string, userId: string): Promise<void> {
    await tx.$executeRaw`
      update public.checkout_orders
         set provisioned_user_id = ${userId}::uuid,
             access_email_sent_at = coalesce(access_email_sent_at, now()),
             provisioning_started_at = null,
             failure_code = null
       where id = ${pedidoId}::uuid
    `;
  }

  /** Serializa o provisionamento por e-mail (dois pedidos do mesmo e-mail não criam duas contas). */
  async travarEmail(tx: Prisma.TransactionClient, email: string): Promise<void> {
    await tx.$executeRaw`
      select pg_advisory_xact_lock(hashtextextended(${`checkout-conta:${email}`}::text, 0))
    `;
  }

  /** Conta pelo e-mail de LOGIN (usuarios primeiro, depois auth.users), com o corretor dela. */
  async contaPorEmailDeLogin(email: string, tx: Prisma.TransactionClient = this.db): Promise<ContaPorEmail | null> {
    const r = await tx.$queryRaw<Array<{ user_id: string; corretor_id: string | null; tem_usuario: boolean; tem_senha: boolean }>>`
      with alvo as (
        select u.id, 1 as ordem from public.usuarios u where lower(btrim(u.email)) = ${email}::text
        union all
        select a.id, 2 as ordem from auth.users a where lower(btrim(a.email)) = ${email}::text
      )
      select a.id::text as user_id,
             (select c.id::text from public.corretores c where c.user_id = a.id limit 1) as corretor_id,
             us.id is not null as tem_usuario,
             coalesce(us.password_hash is not null, false) as tem_senha
      from alvo a
      left join public.usuarios us on us.id = a.id
      order by a.ordem
      limit 1
    `;
    const l = r[0];
    return l ? { userId: l.user_id, corretorId: l.corretor_id, temUsuario: l.tem_usuario, temSenha: l.tem_senha } : null;
  }

  async corretorIdDoUsuario(userId: string, tx: Prisma.TransactionClient = this.db): Promise<string | null> {
    const r = await tx.$queryRaw<Array<{ id: string }>>`
      select id::text as id from public.corretores where user_id = ${userId}::uuid limit 1
    `;
    return r[0]?.id ?? null;
  }

  /** Corretor cujo e-mail de PERFIL é este (a busca que o site fazia em corretores). */
  async corretorPorEmailDePerfil(email: string, tx: Prisma.TransactionClient = this.db): Promise<{ userId: string; corretorId: string } | null> {
    const r = await tx.$queryRaw<Array<{ user_id: string; corretor_id: string }>>`
      select user_id::text as user_id, id::text as corretor_id
      from public.corretores where lower(btrim(email)) = ${email}::text
      limit 1
    `;
    return r[0] ? { userId: r[0].user_id, corretorId: r[0].corretor_id } : null;
  }

  /**
   * Conta antiga (auth.users sem usuarios, antes do preencher-usuarios): cria a linha do login
   * próprio como o script da virada faria (id e bcrypt preservados). Idempotente.
   */
  async garantirUsuario(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$executeRaw`
      insert into public.usuarios (id, email, password_hash, status, created_at)
      select u.id, lower(btrim(u.email)), nullif(u.encrypted_password, ''),
             case when u.banned_until > now() then 'suspenso' else 'ativo' end, coalesce(u.created_at, now())
      from auth.users u
      where u.id = ${userId}::uuid and u.email is not null and btrim(u.email) <> ''
      on conflict (id) do nothing
    `;
  }
}
