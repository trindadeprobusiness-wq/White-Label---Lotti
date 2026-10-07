/**
 * Checkout do site contra o schema REAL (PGlite com todas as migrations):
 *  - pedidos, limite por chave e eventos do webhook pelas RPCs de sempre;
 *  - provisionamento: pedido pago → auth.users + usuarios SEM senha, corretor pelo gatilho,
 *    assinatura ativa (apply_checkout_payment) e pedido marcado; idempotente por pedido e por e-mail;
 *  - link de senha: só o hash no banco; definir-senha grava o bcrypt, incrementa session_version,
 *    e o login seguinte funciona; uso único, validade e invalidação dos outros links;
 *  - e-mail só no perfil de outra conta → ACCOUNT_EMAIL_MISMATCH, sem conta nova.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../../src/auth/auth.service';
import { hashTokenSenha } from '../../src/auth/token-senha';
import { UsuariosRepo } from '../../src/auth/usuarios.repo';
import { CheckoutRepo } from '../../src/checkout/checkout.repo';
import { CheckoutService } from '../../src/checkout/checkout.service';
import type { AppEnv } from '../../src/config/env';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

const PAGINA = 'https://app.plataformalotti.com.br/nova-senha';
const env: AppEnv = {
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x', supabaseUrl: 'https://abc.supabase.co', corsOrigins: [],
  authJwtSecret: 'segredo-de-teste-com-mais-de-32-caracteres!!', authAccessTtl: 900, authRefreshTtl: 2592000,
  authIssuer: 'lotti-api', emailHabilitado: false, checkoutApiToken: 'c'.repeat(40), passwordSetupUrl: PAGINA,
};

const hoje = () => new Date().toISOString().slice(0, 10);
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const tokenDoLink = (link: string) => new URL(link).searchParams.get('token') ?? '';

let banco: BancoTeste;
let usuarios: UsuariosRepo;
let repo: CheckoutRepo;
let checkout: CheckoutService;
let auth: AuthService;

before(async () => {
  banco = await criarBanco();
  const prisma = banco.prisma as unknown as PrismaService;
  usuarios = new UsuariosRepo(prisma);
  repo = new CheckoutRepo(prisma);
  checkout = new CheckoutService(env, repo, usuarios, prisma);
  auth = new AuthService(env, usuarios);
  await banco.inserir('plans', { code: 'profissional', name: 'Profissional', monthly_price: 399, annual_price: 3990 });
});

after(async () => { await banco.fechar(); });

/** Pedido como o site cria e completa depois da resposta do Asaas. */
/** O token de status é único por pedido (access_token_hash é UNIQUE): aleatório quando não importa. */
async function novoPedido(email: string, sufixo: string, tokenStatus = randomBytes(32).toString('hex')): Promise<string> {
  const id = randomUUID();
  await checkout.criarPedido({
    id, access_token_hash: sha(tokenStatus), payer_name: 'Compradora Checkout', payer_email: email,
    payer_document: '11222333000181', payer_phone: '62999990000', plan_code: 'profissional', billing_cycle: 'monthly',
    payment_method: 'CREDIT_CARD', amount: 399,
  });
  await checkout.atualizarPedido(id, { asaas_customer_id: `cus_${sufixo}` });
  await checkout.atualizarPedido(id, { status: 'processing', asaas_subscription_id: `sub_${sufixo}`, asaas_payment_id: `pay_${sufixo}`, failure_code: null });
  return id;
}

const pagamento = (sufixo: string, status = 'CONFIRMED') => ({
  payment_id: `pay_${sufixo}`, customer: `cus_${sufixo}`, subscription: `sub_${sufixo}`, status, due_date: hoje(), amount: 399,
});

describe('pedidos, limite e eventos', () => {
  test('criar, ler (to_jsonb como o PostgREST), buscar pela assinatura e não regredir estado terminal', async () => {
    const id = await novoPedido('pedido.simples@exemplo.com', 'simples', 'a'.repeat(64));
    const p = await checkout.obterPedido(id);
    assert.equal(p.status, 'processing');
    assert.equal(p.amount, 399);
    assert.equal(p.payer_email, 'pedido.simples@exemplo.com');
    assert.equal(p.asaas_subscription_id, 'sub_simples');
    assert.equal(p.access_token_hash, sha('a'.repeat(64)));
    assert.equal((await checkout.buscarPorAssinatura('sub_simples')).id, id);
    assert.equal((await capturarErroHttp(checkout.buscarPorAssinatura('sub_nao_existe'))).status, 404);
    assert.equal((await capturarErroHttp(checkout.obterPedido(randomUUID()))).status, 404);

    // id repetido → 409
    const repetido = await capturarErroHttp(checkout.criarPedido({
      id, access_token_hash: sha('outro'), payer_name: 'X', payer_email: 'x@exemplo.com', payer_document: '11222333000181',
      payer_phone: '62999990000', plan_code: 'profissional', billing_cycle: 'monthly', payment_method: 'PIX', amount: 399,
    }));
    assert.equal(repetido.status, 409);

    await banco.sqlSuperusuario(`update public.checkout_orders set status = 'active' where id = $1::uuid`, [id]);
    const r = await checkout.atualizarPedido(id, { status: 'failed', failure_code: 'CHECKOUT_FAILED' });
    assert.equal(r.linhas, 0, 'status do site não passa por cima de active');
    assert.equal((await checkout.obterPedido(id)).status, 'active');
    assert.equal((await checkout.atualizarPedido(id, { asaas_payment_id: 'pay_2' })).linhas, 1, 'sem status o update segue');
  });

  test('consume_checkout_rate_limit: 10 por chave por minuto; chave fora do formato nunca passa', async () => {
    const chave = sha('203.0.113.9');
    for (let i = 0; i < 10; i += 1) assert.deepEqual(await checkout.consumirLimite(chave), { permitido: true });
    assert.deepEqual(await checkout.consumirLimite(chave), { permitido: false });
    assert.deepEqual(await checkout.consumirLimite('203.0.113.9'), { permitido: false });
  });

  test('claim/finish do evento: uma vez só; falha libera nova tentativa; processado não volta', async () => {
    assert.deepEqual(await checkout.reservarEvento('evt_1', 'PAYMENT_CONFIRMED', 'pay_1'), { reservado: true });
    assert.deepEqual(await checkout.reservarEvento('evt_1', 'PAYMENT_CONFIRMED', 'pay_1'), { reservado: false });
    await checkout.concluirEvento('evt_1', 'failed', 'PROCESSING_FAILED');
    assert.deepEqual(await checkout.reservarEvento('evt_1', 'PAYMENT_CONFIRMED', 'pay_1'), { reservado: true });
    await checkout.concluirEvento('evt_1', 'processed', null);
    assert.deepEqual(await checkout.reservarEvento('evt_1', 'PAYMENT_CONFIRMED', 'pay_1'), { reservado: false });
    const [ev] = await banco.sqlSuperusuario<{ status: string; attempts: number }>(`select status, attempts from public.asaas_checkout_events where id = 'evt_1'`);
    assert.deepEqual(ev, { status: 'processed', attempts: 2 });
  });
});

describe('provisionamento no login próprio', () => {
  const EMAIL = 'nova.compradora@exemplo.com';
  let pedidoId = '';
  let userId = '';
  let link = '';

  test('pedido pago → auth.users + usuarios sem senha, corretor pelo gatilho, assinatura ativa e pedido marcado', async () => {
    pedidoId = await novoPedido(' Nova.Compradora@Exemplo.com ', 'nova', 'f'.repeat(64));
    const r = await checkout.provisionar(pedidoId, pagamento('nova'));
    assert.equal(r.conta_criada, true);
    assert.equal(r.ja_provisionado, false);
    assert.equal(r.senha_definida, false);
    assert.ok(r.link_senha?.startsWith(`${PAGINA}?token=`));
    userId = r.user_id;
    link = r.link_senha!;

    const [authUser] = await banco.sqlSuperusuario<{ email: string; senha: string | null; convidado: boolean; confirmado: boolean; meta: Record<string, unknown> }>(
      `select email, encrypted_password as senha, invited_at is not null as convidado, email_confirmed_at is not null as confirmado,
              raw_user_meta_data as meta from auth.users where id = $1::uuid`, [userId]);
    assert.equal(authUser.email, EMAIL);
    assert.equal(authUser.senha, null);
    assert.equal(authUser.convidado, true);
    assert.equal(authUser.confirmado, true);
    assert.deepEqual(authUser.meta, { nome: 'Compradora Checkout', cnpj: '11222333000181', creci: 'PENDENTE', telefone: '62999990000', origem: 'checkout_asaas' });

    const [usuario] = await banco.sqlSuperusuario<{ email: string; password_hash: string | null; status: string; session_version: number }>(
      'select email, password_hash, status, session_version from public.usuarios where id = $1::uuid', [userId]);
    assert.deepEqual(usuario, { email: EMAIL, password_hash: null, status: 'ativo', session_version: 0 });

    const [corretor] = await banco.sqlSuperusuario<{ id: string; nome: string; email: string; cnpj_cpf: string }>(
      'select id::text as id, nome, email, cnpj_cpf from public.corretores where user_id = $1::uuid', [userId]);
    assert.equal(corretor.id, r.corretor_id);
    assert.equal(corretor.nome, 'Compradora Checkout');
    assert.equal(corretor.email, EMAIL);
    assert.equal(corretor.cnpj_cpf, '11222333000181');

    const [assinatura] = await banco.sqlSuperusuario<{ status: string; externa: string; plano: string; ciclo: string }>(
      `select s.status::text as status, s.external_subscription_id as externa, p.code as plano, s.billing_cycle::text as ciclo
         from public.subscriptions s join public.plans p on p.id = s.plan_id where s.corretor_id = $1::uuid`, [corretor.id]);
    assert.deepEqual(assinatura, { status: 'active', externa: 'sub_nova', plano: 'profissional', ciclo: 'monthly' });

    const p = await checkout.obterPedido(pedidoId);
    assert.equal(p.status, 'active');
    assert.equal(p.provisioned_user_id, userId);
    assert.ok(p.access_email_sent_at);
    assert.equal(p.provisioning_started_at, null);
    assert.equal(p.failure_code, null);

    // O banco só tem o hash do link, ligado ao pedido.
    const tokens = await banco.sqlSuperusuario<{ token_hash: string; finalidade: string; pedido: string; aberto: boolean }>(
      `select token_hash, finalidade, checkout_order_id::text as pedido, used_at is null and expires_at > now() as aberto
         from public.auth_password_tokens where user_id = $1::uuid`, [userId]);
    assert.deepEqual(tokens, [{ token_hash: hashTokenSenha(tokenDoLink(link)), finalidade: 'definir_senha', pedido: pedidoId, aberto: true }]);
    assert.ok(!tokens.some((t) => t.token_hash === tokenDoLink(link)));
  });

  test('idempotente: o mesmo pedido de novo só reaplica o pagamento; o mesmo e-mail em outro pedido não cria outra conta', async () => {
    const antes = await banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from auth.users');
    const de_novo = await checkout.provisionar(pedidoId, pagamento('nova', 'RECEIVED'));
    assert.equal(de_novo.ja_provisionado, true);
    assert.equal(de_novo.user_id, userId);
    assert.equal(de_novo.conta_criada, false);
    const [pago] = await banco.sqlSuperusuario<{ status: string }>(`select status from public.checkout_payments where payment_id = 'pay_nova'`);
    assert.equal(pago.status, 'RECEIVED');

    // Outro pedido do mesmo e-mail, outra assinatura: a conta é a mesma e a regra do banco recusa a 2ª assinatura.
    const outro = await novoPedido(EMAIL.toUpperCase(), 'outra');
    const erro = await capturarErroHttp(checkout.provisionar(outro, pagamento('outra')));
    assert.equal(erro.status, 409);
    assert.equal(erro.corpo.codigo, 'ANOTHER_SUBSCRIPTION_EXISTS');
    const depois = await banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from auth.users');
    assert.equal(depois[0].n, antes[0].n, 'nenhuma conta nova');
    const p = await checkout.obterPedido(outro);
    assert.equal(p.failure_code, 'PROVISIONING_RETRY');
    assert.equal(p.provisioning_started_at, null, 'a reserva foi solta para a próxima entrega');
    assert.equal(p.provisioned_user_id, null);
  });

  test('link da tela de sucesso: confere o token de status, exige pedido ativo e emite um link novo', async () => {
    assert.equal((await capturarErroHttp(checkout.linkSenha(pedidoId, 'e'.repeat(64)))).status, 404);
    const r = await checkout.linkSenha(pedidoId, 'f'.repeat(64));
    assert.equal(r.senha_definida, false);
    assert.ok(r.link_senha?.startsWith(`${PAGINA}?token=`));
    assert.notEqual(r.link_senha, link);
    assert.equal(r.link_entrar, 'https://app.plataformalotti.com.br/auth');
    const abertos = await banco.sqlSuperusuario<{ n: number }>(
      'select count(*)::int as n from public.auth_password_tokens where user_id = $1::uuid and used_at is null', [userId]);
    assert.equal(abertos[0].n, 2);
  });

  test('definir-senha: grava o bcrypt nas duas tabelas, sobe session_version, entra; o link não serve de novo nem os outros', async () => {
    const outroLink = (await checkout.linkSenha(pedidoId, 'f'.repeat(64))).link_senha!;
    const sessao = await auth.definirSenha(tokenDoLink(link), 'senha-do-checkout-1', '203.0.113.50');
    assert.equal(sessao.accessToken.split('.').length, 3);

    const [u] = await banco.sqlSuperusuario<{ password_hash: string; session_version: number; senha_auth: string }>(
      `select us.password_hash, us.session_version, a.encrypted_password as senha_auth
         from public.usuarios us join auth.users a on a.id = us.id where us.id = $1::uuid`, [userId]);
    assert.match(u.password_hash, /^\$2[aby]\$10\$/);
    assert.equal(u.senha_auth, u.password_hash, 'o mesmo bcrypt nas duas tabelas');
    assert.equal(u.session_version, 1);

    await assert.doesNotReject(auth.login(EMAIL, 'senha-do-checkout-1'));
    assert.equal((await capturarErroHttp(auth.login(EMAIL, 'outra-senha'))).status, 401);

    for (const usado of [link, outroLink]) {
      const erro = await capturarErroHttp(auth.definirSenha(tokenDoLink(usado), 'senha-sequestrada-1', '203.0.113.50'));
      assert.equal(erro.status, 400);
      assert.equal(erro.corpo.codigo, 'link_invalido');
    }
    const abertos = await banco.sqlSuperusuario<{ n: number }>(
      'select count(*)::int as n from public.auth_password_tokens where user_id = $1::uuid and used_at is null', [userId]);
    assert.equal(abertos[0].n, 0);
    await assert.doesNotReject(auth.login(EMAIL, 'senha-do-checkout-1'));

    // Conta com senha: a tela de sucesso recebe o link de entrar, nunca um link de senha.
    const r = await checkout.linkSenha(pedidoId, 'f'.repeat(64));
    assert.deepEqual([r.senha_definida, r.link_senha], [true, null]);
  });

  test('a troca de senha derruba as sessões antigas (refresh da versão anterior)', async () => {
    const sessao = await auth.login(EMAIL, 'senha-do-checkout-1');
    const [{ id }] = await banco.sqlSuperusuario<{ id: string }>(
      `select id::text as id from public.usuarios where id = $1::uuid`, [userId]);
    const { token } = await usuarios.emitirTokenSenha({ userId: id, finalidade: 'recuperar_senha', ttlSegundos: 600 });
    await auth.definirSenha(token, 'senha-trocada-22', null);
    assert.equal((await capturarErroHttp(auth.refresh(sessao.refreshToken))).status, 401);
    await assert.doesNotReject(auth.login(EMAIL, 'senha-trocada-22'));
  });

  test('link vencido ou malformado: o mesmo 400; link de definir senha não troca senha que já existe', async () => {
    const vencido = 'V'.repeat(43);
    await banco.inserir('public.auth_password_tokens', {
      user_id: userId, token_hash: hashTokenSenha(vencido), finalidade: 'recuperar_senha', expires_at: '2020-01-01T00:00:00Z',
    });
    const definir = 'D'.repeat(43);
    await banco.inserir('public.auth_password_tokens', {
      user_id: userId, token_hash: hashTokenSenha(definir), finalidade: 'definir_senha', expires_at: '2999-01-01T00:00:00Z',
    });
    for (const t of [vencido, definir, 'malformado!', 'Z'.repeat(43)]) {
      const erro = await capturarErroHttp(auth.definirSenha(t, 'senha-nao-entra-1', null));
      assert.equal(erro.status, 400, t);
      assert.equal(erro.corpo.codigo, 'link_invalido');
    }
    await assert.doesNotReject(auth.login(EMAIL, 'senha-trocada-22'));
  });

  test('auth_password_tokens: RLS habilitada e nenhuma policy (só o dono)', async () => {
    const [t] = await banco.sqlSuperusuario<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'auth_password_tokens') as policies
         from pg_class c where c.oid = 'public.auth_password_tokens'::regclass`);
    assert.deepEqual(t, { rls: true, policies: 0 });
  });
});

describe('contas que já existem', () => {
  test('conta antiga (só auth.users): reaproveita, cria a linha de usuarios e emite o link', async () => {
    const pedido = await novoPedido(banco.contaB.email.toUpperCase(), 'contab');
    const r = await checkout.provisionar(pedido, pagamento('contab'));
    assert.equal(r.user_id, banco.contaB.userId);
    assert.equal(r.corretor_id, banco.corretorB);
    assert.equal(r.conta_criada, false);
    assert.equal(r.senha_definida, false);
    assert.ok(r.link_senha);
    const [u] = await banco.sqlSuperusuario<{ email: string; password_hash: string | null }>(
      'select email, password_hash from public.usuarios where id = $1::uuid', [banco.contaB.userId]);
    assert.deepEqual(u, { email: banco.contaB.email, password_hash: null });
    assert.deepEqual(await checkout.buscarConta(banco.contaB.email), { user_id: banco.contaB.userId, corretor_id: banco.corretorB, email_confere: true });
  });

  test('e-mail só no PERFIL de outra conta: ACCOUNT_EMAIL_MISMATCH, nada criado, reserva solta', async () => {
    const conta = await banco.criarConta({ email: 'login.original@exemplo.com' });
    await banco.sqlSuperusuario(`update public.corretores set email = 'perfil.trocado@exemplo.com' where id = $1::uuid`, [conta.corretorId]);
    assert.deepEqual(await checkout.buscarConta('Perfil.Trocado@exemplo.com'), { user_id: conta.userId, corretor_id: conta.corretorId, email_confere: false });

    const antes = await banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from auth.users');
    const pedido = await novoPedido('perfil.trocado@exemplo.com', 'perfil');
    const erro = await capturarErroHttp(checkout.provisionar(pedido, pagamento('perfil')));
    assert.equal(erro.status, 409);
    assert.equal(erro.corpo.codigo, 'ACCOUNT_EMAIL_MISMATCH');
    const depois = await banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from auth.users');
    assert.equal(depois[0].n, antes[0].n);
    const p = await checkout.obterPedido(pedido);
    assert.deepEqual([p.failure_code, p.provisioning_started_at, p.provisioned_user_id], ['PROVISIONING_RETRY', null, null]);
    assert.equal((await capturarErroHttp(checkout.buscarConta('ninguem@exemplo.com'))).status, 404);
  });

  test('renovação: aplica na conta ligada ao pedido; pedido sem conta → 409', async () => {
    const semConta = await novoPedido('sem.conta@exemplo.com', 'semconta');
    const erro = await capturarErroHttp(checkout.aplicarPagamento(semConta, pagamento('semconta', 'OVERDUE')));
    assert.deepEqual([erro.status, erro.corpo.codigo], [409, 'PROVISIONED_USER_MISSING']);

    const [pedido] = await banco.sqlSuperusuario<{ id: string }>(
      `select id::text as id from public.checkout_orders where asaas_subscription_id = 'sub_nova'`);
    const recusado = await capturarErroHttp(checkout.aplicarPagamento(pedido.id, { ...pagamento('nova'), customer: 'cus_outro' }));
    assert.deepEqual([recusado.status, recusado.corpo.codigo], [409, 'PAYMENT_MISMATCH']);
    await checkout.aplicarPagamento(pedido.id, { ...pagamento('nova'), payment_id: 'pay_nova_2' });
    const pagos = await banco.sqlSuperusuario<{ n: number }>(`select count(*)::int as n from public.checkout_payments where order_id = $1::uuid`, [pedido.id]);
    assert.equal(pagos[0].n, 2);
  });
});
