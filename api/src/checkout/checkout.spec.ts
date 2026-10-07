import { ExecutionContext, INestApplication, ServiceUnavailableException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppEnv, ENV } from '../config/env';
import { UsuariosRepo } from '../auth/usuarios.repo';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutRepo, PedidoCheckout } from './checkout.repo';
import { codigoDoBanco, CheckoutService, tokenDeStatusConfere } from './checkout.service';
import { CheckoutTokenGuard } from './checkout-token.guard';

const SEGREDO = 's'.repeat(40);
const PAGINA = 'https://app.plataformalotti.com.br/nova-senha';
const PEDIDO = '0f1e2d3c-4b5a-4968-8776-655443322110';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORRETOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN_STATUS = 'f'.repeat(64);
const HASH_STATUS = createHash('sha256').update(TOKEN_STATUS).digest('hex');

const envBase = (over: Partial<AppEnv> = {}): AppEnv => ({
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x', supabaseUrl: 'https://abc.supabase.co', corsOrigins: [],
  authAccessTtl: 900, authRefreshTtl: 2592000, authIssuer: 'lotti-api', emailHabilitado: false,
  checkoutApiToken: SEGREDO, passwordSetupUrl: PAGINA, ...over,
});

const pedido = (over: Partial<PedidoCheckout> = {}): PedidoCheckout => ({
  id: PEDIDO, access_token_hash: HASH_STATUS, payer_name: 'Compradora', payer_email: 'compra@exemplo.com',
  payer_document: '11222333000181', payer_phone: '62999990000', plan_code: 'profissional', billing_cycle: 'monthly',
  payment_method: 'CREDIT_CARD', amount: 399, status: 'processing', asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_1',
  asaas_payment_id: 'pay_1', provisioned_user_id: null, access_email_sent_at: null, provisioning_started_at: null,
  failure_code: null, created_at: '2026-10-07T12:00:00.000+00:00', updated_at: '2026-10-07T12:00:00.000+00:00', ...over,
});

const PAGAMENTO = { payment_id: 'pay_1', customer: 'cus_1', subscription: 'sub_1', status: 'CONFIRMED', due_date: '2026-10-07', amount: 399 };

/** Erro do banco como o Prisma entrega um RAISE EXCEPTION. */
const raise = (codigo: string, sqlstate = 'P0001') => new Prisma.PrismaClientKnownRequestError('x', {
  code: 'P2010', clientVersion: 'x', meta: { code: sqlstate, message: `ERROR: ${codigo}` },
});

describe('CheckoutTokenGuard', () => {
  const ctx = (header?: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers: header === undefined ? {} : { 'x-lotti-checkout': header } }) }) }) as unknown as ExecutionContext;

  it('aceita só o segredo certo (tempo constante, qualquer tamanho)', () => {
    const g = new CheckoutTokenGuard(envBase());
    expect(g.canActivate(ctx(SEGREDO))).toBe(true);
    for (const h of [undefined, '', 'x', 's'.repeat(39), 's'.repeat(41), 'x'.repeat(2000), ['nada']]) {
      expect(() => g.canActivate(ctx(h))).toThrow(UnauthorizedException);
    }
  });

  it('sem CHECKOUT_API_TOKEN responde 503 e nunca aceita', () => {
    expect(() => new CheckoutTokenGuard(envBase({ checkoutApiToken: undefined })).canActivate(ctx(SEGREDO)))
      .toThrow(ServiceUnavailableException);
  });
});

describe('regras do checkout', () => {
  it('codigoDoBanco lê só os códigos de negócio do RAISE', () => {
    expect(codigoDoBanco(raise('PAYMENT_MISMATCH'))).toBe('PAYMENT_MISMATCH');
    expect(codigoDoBanco(raise('ANOTHER_SUBSCRIPTION_EXISTS'))).toBe('ANOTHER_SUBSCRIPTION_EXISTS');
    expect(codigoDoBanco(raise('OUTRA_COISA'))).toBeNull();
    expect(codigoDoBanco(raise('PAYMENT_MISMATCH', '23505'))).toBeNull();
    expect(codigoDoBanco(new Error('PAYMENT_MISMATCH'))).toBeNull();
  });

  it('token de status confere pelo SHA-256 em tempo constante', () => {
    expect(tokenDeStatusConfere(TOKEN_STATUS, HASH_STATUS)).toBe(true);
    expect(tokenDeStatusConfere('e'.repeat(64), HASH_STATUS)).toBe(false);
    expect(tokenDeStatusConfere(TOKEN_STATUS, 'nao-hex')).toBe(false);
  });
});

describe('rotas /api/checkout', () => {
  let app: INestApplication;
  let env: AppEnv;
  const tx = { marca: 'tx' };
  const prisma = { $transaction: jest.fn() };
  const repo = {
    consumirLimite: jest.fn(), inserirPedido: jest.fn(), obterPedido: jest.fn(), buscarPorAssinatura: jest.fn(),
    atualizarPedido: jest.fn(), reservarEvento: jest.fn(), concluirEvento: jest.fn(), reservarProvisionamento: jest.fn(),
    liberarProvisionamento: jest.fn(), aplicarPagamento: jest.fn(), marcarProvisionado: jest.fn(), travarEmail: jest.fn(),
    contaPorEmailDeLogin: jest.fn(), corretorPorEmailDePerfil: jest.fn(), garantirUsuario: jest.fn(), corretorIdDoUsuario: jest.fn(),
  };
  const usuarios = { criarContaEm: jest.fn(), emitirTokenSenha: jest.fn(), buscarPorId: jest.fn() };

  beforeAll(async () => {
    env = envBase();
    const ref = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [
        CheckoutService, CheckoutTokenGuard,
        { provide: ENV, useFactory: () => env },
        { provide: CheckoutRepo, useValue: repo },
        { provide: UsuariosRepo, useValue: usuarios },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    Object.assign(env, envBase());
    for (const m of [...Object.values(repo), ...Object.values(usuarios)]) m.mockReset();
    prisma.$transaction.mockReset().mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    repo.travarEmail.mockResolvedValue(undefined);
    repo.liberarProvisionamento.mockResolvedValue(undefined);
  });

  const http = () => request(app.getHttpServer());
  const com = (r: request.Test, segredo: string | null = SEGREDO) => (segredo === null ? r : r.set('x-lotti-checkout', segredo));

  it('sem o segredo certo: 401 em todas as rotas, sem tocar no banco; sem CHECKOUT_API_TOKEN: 503', async () => {
    const rotas: Array<() => request.Test> = [
      () => http().post('/api/checkout/limite').send({ chave: 'a'.repeat(64) }),
      () => http().get(`/api/checkout/pedidos/${PEDIDO}`),
      () => http().post(`/api/checkout/pedidos/${PEDIDO}/provisionar`).send(PAGAMENTO),
      () => http().get('/api/checkout/contas?email=a@b.com'),
    ];
    for (const rota of rotas) {
      expect((await com(rota(), null)).status).toBe(401);
      expect((await com(rota(), 'errado')).status).toBe(401);
    }
    env.checkoutApiToken = undefined;
    expect((await com(rotas[0]())).status).toBe(503);
    expect(Object.values(repo).every((m) => m.mock.calls.length === 0)).toBe(true);
  });

  it('limite: consume_checkout_rate_limit; sem a página de senha o checkout nem começa (503)', async () => {
    repo.consumirLimite.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const chave = 'b'.repeat(64);
    expect((await com(http().post('/api/checkout/limite').send({ chave }))).body).toEqual({ permitido: true });
    expect((await com(http().post('/api/checkout/limite').send({ chave }))).body).toEqual({ permitido: false });
    expect(repo.consumirLimite).toHaveBeenCalledWith(chave);

    env.passwordSetupUrl = undefined;
    const r = await com(http().post('/api/checkout/limite').send({ chave }));
    expect(r.status).toBe(503);
    expect(r.body.codigo).toBe('checkout_nao_configurado');
    expect(repo.consumirLimite).toHaveBeenCalledTimes(2);
  });

  it('criar pedido: valida o corpo como os CHECKs da tabela; e-mail minúsculo; id repetido → 409', async () => {
    const corpo = {
      id: PEDIDO, access_token_hash: HASH_STATUS, payer_name: 'Compradora', payer_email: ' Compra@Exemplo.com ',
      payer_document: '11222333000181', payer_phone: '62999990000', plan_code: 'profissional', billing_cycle: 'monthly',
      payment_method: 'CREDIT_CARD', amount: 399,
    };
    repo.inserirPedido.mockResolvedValueOnce(undefined).mockRejectedValueOnce(raise('x', '23505'));
    const ok = await com(http().post('/api/checkout/pedidos').send(corpo));
    expect([ok.status, ok.body]).toEqual([201, { ok: true }]);
    expect(repo.inserirPedido.mock.calls[0][0]).toMatchObject({ payer_email: 'compra@exemplo.com', amount: 399 });

    const repetido = await com(http().post('/api/checkout/pedidos').send(corpo));
    expect([repetido.status, repetido.body.codigo]).toEqual([409, 'pedido_existente']);

    for (const errado of [
      { plan_code: 'gratis' }, { billing_cycle: 'weekly' }, { payment_method: 'BOLETO' }, { amount: 0 }, { amount: 1.234 },
      { payer_document: '123' }, { access_token_hash: 'curto' }, { id: 'nao-uuid' }, { status: 'active' },
    ]) {
      const r = await com(http().post('/api/checkout/pedidos').send({ ...corpo, ...errado }));
      expect(r.status).toBe(400);
    }
    expect(repo.inserirPedido).toHaveBeenCalledTimes(2);
  });

  it('obter e buscar por assinatura: 200 com a linha; 404 para inexistente ou id fora do formato', async () => {
    repo.obterPedido.mockResolvedValueOnce(pedido()).mockResolvedValueOnce(null);
    const ok = await com(http().get(`/api/checkout/pedidos/${PEDIDO}`));
    expect([ok.status, ok.body.access_token_hash, ok.body.amount]).toEqual([200, HASH_STATUS, 399]);
    expect((await com(http().get(`/api/checkout/pedidos/${PEDIDO}`))).status).toBe(404);
    expect((await com(http().get('/api/checkout/pedidos/0f1e2d3c-xxxx-4968-8776-655443322110'))).status).toBe(404);
    expect(repo.obterPedido).toHaveBeenCalledTimes(2);

    repo.buscarPorAssinatura.mockResolvedValueOnce(pedido()).mockResolvedValueOnce(null);
    expect((await com(http().get('/api/checkout/pedidos?assinatura=sub_1'))).body.id).toBe(PEDIDO);
    expect((await com(http().get('/api/checkout/pedidos?assinatura=sub_x'))).status).toBe(404);
    expect((await com(http().get('/api/checkout/pedidos'))).status).toBe(400);
  });

  it('atualizar: só os campos do site; ligar o pedido a uma conta ou marcar active é recusado (400)', async () => {
    repo.atualizarPedido.mockResolvedValue(1);
    const r = await com(http().patch(`/api/checkout/pedidos/${PEDIDO}`).send({ status: 'awaiting_payment', asaas_payment_id: 'pay_9', failure_code: null }));
    expect([r.status, r.body]).toEqual([200, { ok: true, linhas: 1 }]);
    expect(repo.atualizarPedido).toHaveBeenCalledWith(PEDIDO, {
      status: 'awaiting_payment', asaas_customer_id: undefined, asaas_subscription_id: undefined, asaas_payment_id: 'pay_9', failure_code: null,
    });
    for (const proibido of [{ provisioned_user_id: USER }, { access_email_sent_at: '2026-10-07' }, { status: 'active' }, { status: 'refunded' }]) {
      expect((await com(http().patch(`/api/checkout/pedidos/${PEDIDO}`).send(proibido))).status).toBe(400);
    }
    expect((await com(http().patch(`/api/checkout/pedidos/${PEDIDO}`).send({}))).body).toEqual({ ok: true, linhas: 0 });
    expect(repo.atualizarPedido).toHaveBeenCalledTimes(1);
  });

  it('eventos: claim e finish do webhook', async () => {
    repo.reservarEvento.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await com(http().post('/api/checkout/eventos/reservar').send({ id: 'evt_1', event_type: 'PAYMENT_CONFIRMED', payment_id: 'pay_1' }))).body)
      .toEqual({ reservado: true });
    expect((await com(http().post('/api/checkout/eventos/reservar').send({ id: 'evt_1', event_type: 'PAYMENT_CONFIRMED' }))).body)
      .toEqual({ reservado: false });
    expect(repo.reservarEvento.mock.calls).toEqual([['evt_1', 'PAYMENT_CONFIRMED', 'pay_1'], ['evt_1', 'PAYMENT_CONFIRMED', null]]);

    repo.concluirEvento.mockResolvedValue(undefined);
    expect((await com(http().post('/api/checkout/eventos/concluir').send({ id: 'evt_1', status: 'failed', error_code: 'PROCESSING_FAILED' }))).body)
      .toEqual({ ok: true });
    expect(repo.concluirEvento).toHaveBeenCalledWith('evt_1', 'failed', 'PROCESSING_FAILED');
    expect((await com(http().post('/api/checkout/eventos/concluir').send({ id: 'evt_1', status: 'received' }))).status).toBe(400);
  });

  it('pagamento: aplica na conta JÁ ligada ao pedido; sem conta → 409; RAISE do banco → 409 com o código', async () => {
    repo.obterPedido.mockResolvedValue(pedido());
    const sem = await com(http().post(`/api/checkout/pedidos/${PEDIDO}/pagamento`).send({ ...PAGAMENTO, status: 'OVERDUE' }));
    expect([sem.status, sem.body.codigo]).toEqual([409, 'PROVISIONED_USER_MISSING']);

    repo.obterPedido.mockResolvedValue(pedido({ provisioned_user_id: USER }));
    repo.aplicarPagamento.mockResolvedValueOnce(undefined).mockRejectedValueOnce(raise('PAYMENT_MISMATCH'));
    expect((await com(http().post(`/api/checkout/pedidos/${PEDIDO}/pagamento`).send({ ...PAGAMENTO, status: 'OVERDUE', user_id: 'x' }))).status)
      .toBe(400); // quem chama não escolhe a conta
    const ok = await com(http().post(`/api/checkout/pedidos/${PEDIDO}/pagamento`).send({ ...PAGAMENTO, status: 'OVERDUE' }));
    expect([ok.status, ok.body]).toEqual([200, { ok: true }]);
    expect(repo.aplicarPagamento).toHaveBeenCalledWith(tx, PEDIDO, expect.objectContaining({ status: 'OVERDUE' }), USER);
    const recusado = await com(http().post(`/api/checkout/pedidos/${PEDIDO}/pagamento`).send(PAGAMENTO));
    expect([recusado.status, recusado.body.codigo]).toEqual([409, 'PAYMENT_MISMATCH']);
    expect((await com(http().post(`/api/checkout/pedidos/${PEDIDO}/pagamento`).send({ ...PAGAMENTO, due_date: '2026-13-45' }))).status).toBe(400);
  });

  it('provisionar conta nova: cria sem senha (origem checkout), aplica, marca e devolve o link de criar senha', async () => {
    repo.obterPedido.mockResolvedValue(pedido());
    repo.reservarProvisionamento.mockResolvedValue(true);
    repo.contaPorEmailDeLogin.mockResolvedValue(null);
    repo.corretorPorEmailDePerfil.mockResolvedValue(null);
    usuarios.criarContaEm.mockResolvedValue({ id: USER, email: 'compra@exemplo.com', passwordHash: null, status: 'ativo', sessionVersion: 0 });
    repo.corretorIdDoUsuario.mockResolvedValue(CORRETOR);
    usuarios.emitirTokenSenha.mockResolvedValue({ token: 'tok-cru_123', expiraEm: new Date('2026-10-08T12:00:00Z') });

    const r = await com(http().post(`/api/checkout/pedidos/${PEDIDO}/provisionar`).send(PAGAMENTO));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      user_id: USER, corretor_id: CORRETOR, conta_criada: true, ja_provisionado: false, senha_definida: false,
      link_senha: `${PAGINA}?token=tok-cru_123`, link_expira_em: '2026-10-08T12:00:00.000Z',
    });
    expect(repo.travarEmail).toHaveBeenCalledWith(tx, 'compra@exemplo.com');
    expect(usuarios.criarContaEm).toHaveBeenCalledWith(tx, {
      email: 'compra@exemplo.com', passwordHash: null, nome: 'Compradora', cnpj: '11222333000181', telefone: '62999990000',
      origem: 'checkout_asaas', convite: true,
    });
    expect(repo.aplicarPagamento).toHaveBeenCalledWith(tx, PEDIDO, expect.objectContaining({ payment_id: 'pay_1' }), USER);
    expect(repo.marcarProvisionado).toHaveBeenCalledWith(tx, PEDIDO, USER);
    expect(usuarios.emitirTokenSenha).toHaveBeenCalledWith({ userId: USER, finalidade: 'definir_senha', ttlSegundos: 86400, pedidoId: PEDIDO }, tx);
    expect(repo.liberarProvisionamento).not.toHaveBeenCalled();
  });

  it('provisionar conta existente com senha: sem conta nova e sem link', async () => {
    repo.obterPedido.mockResolvedValue(pedido());
    repo.reservarProvisionamento.mockResolvedValue(true);
    repo.contaPorEmailDeLogin.mockResolvedValue({ userId: USER, corretorId: CORRETOR, temUsuario: true, temSenha: true });
    const r = await com(http().post(`/api/checkout/pedidos/${PEDIDO}/provisionar`).send(PAGAMENTO));
    expect(r.body).toMatchObject({ user_id: USER, conta_criada: false, senha_definida: true, link_senha: null });
    expect(usuarios.criarContaEm).not.toHaveBeenCalled();
    expect(usuarios.emitirTokenSenha).not.toHaveBeenCalled();
    expect(repo.garantirUsuario).not.toHaveBeenCalled();
  });

  it('provisionar: e-mail só no perfil de outra conta → 409 ACCOUNT_EMAIL_MISMATCH e a reserva é solta', async () => {
    repo.obterPedido.mockResolvedValue(pedido());
    repo.reservarProvisionamento.mockResolvedValue(true);
    repo.contaPorEmailDeLogin.mockResolvedValue(null);
    repo.corretorPorEmailDePerfil.mockResolvedValue({ userId: USER, corretorId: CORRETOR });
    const r = await com(http().post(`/api/checkout/pedidos/${PEDIDO}/provisionar`).send(PAGAMENTO));
    expect([r.status, r.body.codigo]).toEqual([409, 'ACCOUNT_EMAIL_MISMATCH']);
    expect(repo.aplicarPagamento).not.toHaveBeenCalled();
    expect(repo.liberarProvisionamento).toHaveBeenCalledWith(PEDIDO);
  });

  it('provisionar: pagamento recusado pelo banco desfaz tudo (transação) e solta a reserva', async () => {
    repo.obterPedido.mockResolvedValue(pedido());
    repo.reservarProvisionamento.mockResolvedValue(true);
    repo.contaPorEmailDeLogin.mockResolvedValue({ userId: USER, corretorId: CORRETOR, temUsuario: true, temSenha: false });
    repo.aplicarPagamento.mockRejectedValue(raise('ANOTHER_SUBSCRIPTION_EXISTS'));
    const r = await com(http().post(`/api/checkout/pedidos/${PEDIDO}/provisionar`).send(PAGAMENTO));
    expect([r.status, r.body.codigo]).toEqual([409, 'ANOTHER_SUBSCRIPTION_EXISTS']);
    expect(repo.marcarProvisionado).not.toHaveBeenCalled();
    expect(repo.liberarProvisionamento).toHaveBeenCalledWith(PEDIDO);
  });

  it('provisionar: reserva ocupada → 409 PROVISIONING_BUSY; pedido já provisionado → só reaplica o pagamento', async () => {
    repo.obterPedido.mockResolvedValue(pedido());
    repo.reservarProvisionamento.mockResolvedValue(false);
    const ocupado = await com(http().post(`/api/checkout/pedidos/${PEDIDO}/provisionar`).send(PAGAMENTO));
    expect([ocupado.status, ocupado.body.codigo]).toEqual([409, 'PROVISIONING_BUSY']);

    repo.obterPedido.mockResolvedValue(pedido({ status: 'active', provisioned_user_id: USER, access_email_sent_at: '2026-10-07T12:00:00Z' }));
    usuarios.buscarPorId.mockResolvedValue({ id: USER, email: 'compra@exemplo.com', passwordHash: null, status: 'ativo', sessionVersion: 0 });
    repo.corretorIdDoUsuario.mockResolvedValue(CORRETOR);
    const de_novo = await com(http().post(`/api/checkout/pedidos/${PEDIDO}/provisionar`).send(PAGAMENTO));
    expect(de_novo.body).toMatchObject({ user_id: USER, corretor_id: CORRETOR, ja_provisionado: true, conta_criada: false, link_senha: null });
    expect(repo.aplicarPagamento).toHaveBeenCalledWith(tx, PEDIDO, expect.anything(), USER);
    expect(usuarios.criarContaEm).not.toHaveBeenCalled();
    expect(repo.liberarProvisionamento).not.toHaveBeenCalled();
  });

  it('link-senha: token de status conferido de novo; só pedido ativo e provisionado; conta com senha recebe o link de entrar', async () => {
    const ativo = pedido({ status: 'active', provisioned_user_id: USER, access_email_sent_at: '2026-10-07T12:00:00Z' });
    const rota = (token = TOKEN_STATUS) => com(http().post(`/api/checkout/pedidos/${PEDIDO}/link-senha`).send({ token }));

    repo.obterPedido.mockResolvedValue(ativo);
    expect((await rota('e'.repeat(64))).status).toBe(404);

    repo.obterPedido.mockResolvedValue(pedido({ status: 'processing' }));
    expect((await rota()).body.codigo).toBe('pedido_nao_provisionado');

    repo.obterPedido.mockResolvedValue(ativo);
    usuarios.buscarPorId.mockResolvedValue({ id: USER, email: 'compra@exemplo.com', passwordHash: null, status: 'ativo', sessionVersion: 0 });
    usuarios.emitirTokenSenha.mockResolvedValue({ token: 'novo_tok', expiraEm: new Date('2026-10-08T12:00:00Z') });
    const sem = await rota();
    expect([sem.status, sem.body]).toEqual([200, {
      senha_definida: false, link_senha: `${PAGINA}?token=novo_tok`, link_expira_em: '2026-10-08T12:00:00.000Z',
      link_entrar: 'https://app.plataformalotti.com.br/auth',
    }]);
    expect(usuarios.emitirTokenSenha).toHaveBeenCalledWith({ userId: USER, finalidade: 'definir_senha', ttlSegundos: 86400, pedidoId: PEDIDO });

    usuarios.buscarPorId.mockResolvedValue({ id: USER, email: 'compra@exemplo.com', passwordHash: '$2a$10$x', status: 'ativo', sessionVersion: 1 });
    expect((await rota()).body).toEqual({ senha_definida: true, link_senha: null, link_expira_em: null, link_entrar: 'https://app.plataformalotti.com.br/auth' });
    expect(usuarios.emitirTokenSenha).toHaveBeenCalledTimes(1);

    usuarios.buscarPorId.mockResolvedValue({ id: USER, email: 'compra@exemplo.com', passwordHash: null, status: 'suspenso', sessionVersion: 0 });
    expect((await rota()).body.codigo).toBe('conta_indisponivel');
    expect((await rota('curto')).status).toBe(400);
  });

  it('contas: por e-mail de login; só o perfil bater → email_confere false; nenhuma → 404', async () => {
    repo.contaPorEmailDeLogin.mockResolvedValueOnce({ userId: USER, corretorId: CORRETOR, temUsuario: true, temSenha: true }).mockResolvedValue(null);
    repo.corretorPorEmailDePerfil.mockResolvedValueOnce({ userId: USER, corretorId: CORRETOR }).mockResolvedValueOnce(null);
    expect((await com(http().get('/api/checkout/contas?email=Compra@Exemplo.com'))).body)
      .toEqual({ user_id: USER, corretor_id: CORRETOR, email_confere: true });
    expect(repo.contaPorEmailDeLogin).toHaveBeenCalledWith('compra@exemplo.com');
    expect((await com(http().get('/api/checkout/contas?email=compra@exemplo.com'))).body.email_confere).toBe(false);
    expect((await com(http().get('/api/checkout/contas?email=ninguem@exemplo.com'))).status).toBe(404);
    expect((await com(http().get('/api/checkout/contas?email=nao-email'))).status).toBe(400);
  });
});
