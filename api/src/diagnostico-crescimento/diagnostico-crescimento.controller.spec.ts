import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DiagnosticoCrescimentoController, DiagnosticoCrescimentoWorkerController, segredoConfere } from './diagnostico-crescimento.controller';
import { DiagnosticoCrescimentoRepo } from './diagnostico-crescimento.repo';
import { DiagnosticoCrescimentoService, respostaDeErro } from './diagnostico-crescimento.service';
import { ErroPublico, sha256 } from './contratos';

/**
 * As rotas com o analisador de JSON e o pipe de produção e o repo falso: status e corpo `{ error }`
 * da Edge, cabeçalhos, teto de 16 KiB, Retry-After do 429, 503 sem segredo e o worker com Bearer.
 * O fluxo de verdade (SQL, transação, ramos) está em test/sql-real/diagnostico-crescimento.test.ts.
 */
const SESSAO = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'c'.repeat(64);
const SEGREDO_WORKER = 'w'.repeat(40);
const snapshot = (extra: Record<string, unknown> = {}) => ({
  session: {
    id: SESSAO, status: 'started', started_at: '2026-10-08T12:00:00+00:00', last_activity_at: '2026-10-08T12:00:00+00:00',
    completed_at: null, version: 0, score: null, temperature: null, token_hash: 'nunca', ...extra,
  },
  answers: {}, summary: null, lead: null, events: [{ event_type: 'diagnostic_started' }],
});

describe('DiagnosticoCrescimentoController', () => {
  let app: NestExpressApplication;
  const repo = {
    consumirLimite: jest.fn(async () => true as unknown),
    mutar: jest.fn(async () => snapshot()),
    reservarIa: jest.fn(),
    reivindicarNotificacoes: jest.fn(async () => []),
    concluirNotificacao: jest.fn(),
    manutencao: jest.fn(async () => 2),
  };
  const VARIAVEIS = ['DIAGNOSTIC_RATE_LIMIT_SECRET', 'PUBLIC_RATE_LIMIT_SECRET', 'DIAGNOSTIC_WORKER_SECRET', 'DIAGNOSTIC_NOTIFICATIONS_ENABLED'];
  const salvas: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const v of VARIAVEIS) { salvas[v] = process.env[v]; delete process.env[v]; }
    const ref = await Test.createTestingModule({
      controllers: [DiagnosticoCrescimentoController, DiagnosticoCrescimentoWorkerController],
      providers: [DiagnosticoCrescimentoService, { provide: DiagnosticoCrescimentoRepo, useValue: repo }],
    }).compile();
    app = ref.createNestApplication<NestExpressApplication>();
    app.useBodyParser('json', { limit: '21mb' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    for (const v of VARIAVEIS) { if (salvas[v] === undefined) delete process.env[v]; else process.env[v] = salvas[v]; }
  });
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_RATE_LIMIT_SECRET = 'segredo-de-teste';
    delete process.env.DIAGNOSTIC_RATE_LIMIT_SECRET;
  });

  const http = () => request(app.getHttpServer());
  const inicio = { action: 'start', consent: true, session_id: SESSAO, token: TOKEN, tracking: { utm_source: 'ig' } };

  it('start: snapshot público, sem score/token, com no-store e nosniff', async () => {
    const r = await http().post('/api/publico/diagnostico').set('x-forwarded-for', '203.0.113.9').send(inicio).expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.body).toEqual({
      session: { id: SESSAO, status: 'started', started_at: '2026-10-08T12:00:00+00:00', last_activity_at: '2026-10-08T12:00:00+00:00', completed_at: null, version: 0 },
      answers: {}, next_question: expect.objectContaining({ id: 'name', type: 'text' }), summary: null, cta_requested: false,
    });
    expect(JSON.stringify(r.body)).not.toContain('nunca');
    const [ipHash, sessao, eInicio] = repo.consumirLimite.mock.calls[0] as unknown as [string, string, boolean];
    expect(ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect([sessao, eInicio]).toEqual([SESSAO, true]);
    // Só o SHA-256 do token vai ao banco; o UTM vai limpo e com a origem deduzida.
    expect(repo.mutar).toHaveBeenCalledWith(SESSAO, sha256(TOKEN), 'start', null, { consent: true, tracking: { utm_source: 'ig', source: 'ig' } });
  });

  it('o IP vira HMAC com o segredo: o mesmo IP dá o mesmo hash, outro IP outro hash', async () => {
    await http().post('/api/publico/diagnostico').set('x-forwarded-for', '203.0.113.9').send(inicio);
    await http().post('/api/publico/diagnostico').set('x-forwarded-for', '203.0.113.9').send(inicio);
    await http().post('/api/publico/diagnostico').set('x-forwarded-for', '198.51.100.7').send(inicio);
    const hashes = repo.consumirLimite.mock.calls.map((c) => (c as unknown as string[])[0]);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
    expect(hashes.join()).not.toContain('203.0.113.9');
  });

  it('sem segredo de limite: 503 antes de tocar o banco', async () => {
    delete process.env.PUBLIC_RATE_LIMIT_SECRET;
    const r = await http().post('/api/publico/diagnostico').send(inicio).expect(503);
    expect(r.body).toEqual({ error: 'Diagnóstico temporariamente indisponível.' });
    expect(repo.consumirLimite).not.toHaveBeenCalled();
  });

  it('limite estourado: 429 com Retry-After de 1 hora', async () => {
    repo.consumirLimite.mockResolvedValueOnce(false);
    const r = await http().post('/api/publico/diagnostico').send(inicio).expect(429);
    expect(r.headers['retry-after']).toBe('3600');
    expect(r.body).toEqual({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' });
    expect(repo.mutar).not.toHaveBeenCalled();
  });

  it('corpo acima de 16 KiB: 413 sem ler nada', async () => {
    const r = await http().post('/api/publico/diagnostico').send({ ...inicio, honeypot: 'x'.repeat(17_000) }).expect(413);
    expect(r.body).toEqual({ error: 'Requisição muito grande.' });
    expect(repo.consumirLimite).not.toHaveBeenCalled();
  });

  it('credenciais, ação, consentimento e honeypot com os textos da Edge', async () => {
    const casos: Array<[Record<string, unknown>, number, string]> = [
      [{ ...inicio, session_id: 'x' }, 400, 'Sessão inválida.'],
      [{ ...inicio, token: SESSAO, session_id: SESSAO }, 400, 'Sessão inválida.'],
      [{ ...inicio, action: 'apagar' }, 400, 'Ação inválida.'],
      [{ ...inicio, honeypot: 'robô' }, 400, 'Não foi possível iniciar este diagnóstico.'],
      [{ ...inicio, consent: false }, 400, 'Confirme a política de privacidade para começar.'],
      [{ ...inicio, tracking: { utm_source: 1 } }, 400, 'Origem inválida.'],
    ];
    for (const [corpo, status, erro] of casos) {
      const r = await http().post('/api/publico/diagnostico').send(corpo);
      expect([r.status, r.body]).toEqual([status, { error: erro }]);
    }
  });

  it('erro do banco que não é da sessão vira 503 genérico (texto do Postgres nunca sai)', async () => {
    repo.mutar.mockRejectedValueOnce(new Error('diagnostic_database_error'));
    const r = await http().post('/api/publico/diagnostico').send(inicio).expect(503);
    expect(r.body).toEqual({ error: 'Diagnóstico temporariamente indisponível. Tente novamente.' });
    expect(respostaDeErro(new ErroPublico(404, 'Sessão não encontrada.'))).toEqual({ status: 404, corpo: { error: 'Sessão não encontrada.' } });
    expect(respostaDeErro(new Error('qualquer coisa'))).toEqual({ status: 500, corpo: { error: 'Não foi possível salvar sua resposta. Tente novamente.' } });
  });

  it('answer com versão desatualizada: 409 e nada gravado', async () => {
    repo.mutar.mockResolvedValueOnce(snapshot({ version: 3 }));
    const r = await http().post('/api/publico/diagnostico')
      .send({ action: 'answer', session_id: SESSAO, token: TOKEN, version: 2, question_id: 'name', answer: 'Ana' }).expect(409);
    expect(r.body).toEqual({ error: 'Sua conversa foi atualizada em outra aba. Retome as respostas salvas.' });
    expect(repo.mutar).toHaveBeenCalledTimes(1);
  });

  describe('worker de manutenção', () => {
    const worker = () => http().post('/api/diagnostico/manutencao');

    it('sem DIAGNOSTIC_WORKER_SECRET (ou curta) recusa tudo com 401', async () => {
      await worker().set('Authorization', `Bearer ${SEGREDO_WORKER}`).send({ action: 'maintenance' }).expect(401, { error: 'Unauthorized' });
      process.env.DIAGNOSTIC_WORKER_SECRET = 'curta';
      await worker().set('Authorization', 'Bearer curta').send({ action: 'maintenance' }).expect(401);
      expect(repo.manutencao).not.toHaveBeenCalled();
    });

    it('Bearer certo roda a manutenção; errado 401; ação desconhecida 400', async () => {
      process.env.DIAGNOSTIC_WORKER_SECRET = SEGREDO_WORKER;
      await worker().set('Authorization', `Bearer ${'x'.repeat(40)}`).send({ action: 'maintenance' }).expect(401);
      await worker().set('Authorization', `Bearer ${SEGREDO_WORKER}`).send({ action: 'outra' }).expect(400, { error: 'Invalid action' });
      const r = await worker().set('Authorization', `Bearer ${SEGREDO_WORKER}`).send({ action: 'maintenance' }).expect(200);
      expect(r.body).toEqual({ ok: true, abandoned: 2, notifications: { sent: 0, failed: 0 } });
      // Interruptor desligado: a fila não é nem reivindicada.
      expect(repo.reivindicarNotificacoes).not.toHaveBeenCalled();
    });

    it('falha do banco: 503 genérico', async () => {
      process.env.DIAGNOSTIC_WORKER_SECRET = SEGREDO_WORKER;
      repo.manutencao.mockRejectedValueOnce(new Error('diagnostic_database_error'));
      await worker().set('Authorization', `Bearer ${SEGREDO_WORKER}`).send({ action: 'maintenance' }).expect(503, { error: 'Maintenance unavailable' });
    });

    it('comparação do segredo em tempo constante e só com o mesmo tamanho', () => {
      expect(segredoConfere('abc', 'abc')).toBe(true);
      expect(segredoConfere('abd', 'abc')).toBe(false);
      expect(segredoConfere('ab', 'abc')).toBe(false);
    });
  });
});
