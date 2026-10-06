import { CanActivate, HttpException, INestApplication, PayloadTooLargeException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AcaoIaService } from './acao.service';
import { AnexosIaService } from './anexos.service';
import { AssistenteService, EventoAssistente } from './assistente.service';
import { ConversasService } from './conversas.service';
import { FotosIaService } from './fotos.service';
import { IaConversasController } from './ia-conversas.controller';
import { FiltroAnexoIa, IaController } from './ia.controller';
import { MensagensIaService } from './mensagens.service';

const A = '11111111-1111-4111-8111-111111111111';
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: 'u1', role: 'authenticated' };

describe('controllers de IA', () => {
  let app: INestApplication;
  const assistente = {
    preparar: jest.fn(async (..._a: unknown[]) => ({ sessao: 1 }) as unknown),
    transmitir: jest.fn(async (_s: unknown, emitir: (e: EventoAssistente) => void) => {
      emitir({ type: 'text', content: 'Olá' });
      emitir({ type: 'done', conversation_id: A, trace_id: 't', prompt_version: 'v' });
    }),
  };
  const acao = { decidir: jest.fn(async () => ({ status: 'rejected', proposal_id: A })) };
  const anexos = { processar: jest.fn(async (..._a: unknown[]) => ({ storage_path: 'u/1.txt' })) };
  const fotos = {
    analisarFoto: jest.fn(async () => ({ params: {} })),
    analisarFotosImovel: jest.fn(async () => ({ fotos: [], descricao_sugerida: null })),
    salvarDescricao: jest.fn(async (..._a: unknown[]) => ({ id: A, descricao: 'x' })),
  };
  const mensagens = {
    gerarWhatsapp: jest.fn(async () => ({ message: 'oi', model: 'm', prompt_version: 'v' })),
    imoveisParaSugestao: jest.fn(async () => [{ id: A, titulo: 'Casa' }]),
    sugerirResposta: jest.fn(async () => ({ suggestion: 's', propertyId: A, requiresReview: true })),
  };
  const conversas = {
    listar: jest.fn(async () => [{ id: A }]),
    alterar: jest.fn(async (..._a: unknown[]) => ({ id: A })),
    apagar: jest.fn(async (..._a: unknown[]) => undefined),
    mensagens: jest.fn(async (..._a: unknown[]) => [{ id: 'm' }]),
  };
  const guard: CanActivate = {
    canActivate: (ctx) => {
      ctx.switchToHttp().getRequest().claims = claims;
      return true;
    },
  };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IaConversasController, IaController],
      providers: [
        { provide: AssistenteService, useValue: assistente },
        { provide: AcaoIaService, useValue: acao },
        { provide: AnexosIaService, useValue: anexos },
        { provide: FotosIaService, useValue: fotos },
        { provide: MensagensIaService, useValue: mensagens },
        { provide: ConversasService, useValue: conversas },
      ],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('assistente: text/event-stream com os eventos no formato data: {...}', async () => {
    const r = await http().post('/api/ia/assistente').send({ message: 'oi', conversation_id: null, module: 'assistant' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/event-stream');
    expect(r.headers['cache-control']).toBe('private, no-cache, no-store, must-revalidate, max-age=0, no-transform');
    expect(r.headers['x-accel-buffering']).toBe('no');
    expect(r.text).toBe(`data: {"type":"text","content":"Olá"}\n\ndata: {"type":"done","conversation_id":"${A}","trace_id":"t","prompt_version":"v"}\n\n`);
    expect(assistente.preparar).toHaveBeenCalledWith(claims, expect.objectContaining({ message: 'oi', module: 'assistant' }));
    expect(assistente.transmitir.mock.calls[0][0]).toEqual({ sessao: 1 });
  });

  it('assistente: erro antes do stream sai como JSON com status; chave desconhecida → 400', async () => {
    assistente.preparar.mockRejectedValueOnce(new HttpException({ statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', message: 'Seu plano atual não inclui o Assistente Lotti.' }, 402));
    const r = await http().post('/api/ia/assistente').send({ message: 'oi' });
    expect(r.status).toBe(402);
    expect(r.body).toEqual({ statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', message: 'Seu plano atual não inclui o Assistente Lotti.' });
    expect(assistente.transmitir).not.toHaveBeenCalled();
    expect((await http().post('/api/ia/assistente').send({ message: 'oi', corretor_id: A })).status).toBe(400);
  });

  it('acao: valida proposal_id e decision com o texto da função', async () => {
    const ruim = await http().post('/api/ia/acao').send({ proposal_id: 'x', decision: 'talvez' });
    expect(ruim.status).toBe(400);
    expect(ruim.body.message).toEqual(['Solicitação inválida.', 'Solicitação inválida.']);
    const ok = await http().post('/api/ia/acao').send({ proposal_id: A, decision: 'reject' });
    expect(ok.status).toBe(200);
    expect(acao.decidir).toHaveBeenCalledWith(claims, expect.objectContaining({ proposal_id: A, decision: 'reject' }));
  });

  it('anexos: multipart com file e message_id chega ao service com o buffer', async () => {
    const r = await http().post('/api/ia/anexos').field('message_id', A).attach('file', Buffer.from('conteúdo'), { filename: 'notas.txt', contentType: 'text/plain' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ storage_path: 'u/1.txt' });
    const [c, arquivo, messageId] = anexos.processar.mock.calls[0] as [unknown, { originalname: string; mimetype: string; size: number; buffer: Buffer }, string];
    expect(c).toBe(claims);
    expect(arquivo).toMatchObject({ originalname: 'notas.txt', mimetype: 'text/plain', size: Buffer.byteLength('conteúdo') });
    expect(arquivo.buffer.toString()).toBe('conteúdo');
    expect(messageId).toBe(A);
  });

  it('anexos: campo errado vira 400 em português; arquivo grande demais vira 413', async () => {
    const r = await http().post('/api/ia/anexos').attach('outro', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ statusCode: 400, codigo: 'arquivo_invalido', message: 'Envie um único arquivo no campo "file".' });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    new FiltroAnexoIa().catch(new PayloadTooLargeException('File too large'), { switchToHttp: () => ({ getResponse: () => res }) } as never);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 413, codigo: 'arquivo_grande_demais', message: 'Arquivo muito grande (máx. 50 MB).' });
  });

  it('fotos e WhatsApp: mensagens de validação da função', async () => {
    const foto = await http().post('/api/ia/analisar-foto').send({ imageBase64: 'QUJD', mimeType: 'image/gif' });
    expect(foto.status).toBe(400);
    expect(foto.body.message).toEqual(['Formato de imagem inválido']);
    expect((await http().post('/api/ia/analisar-foto').send({ imageBase64: 'QUJD', mimeType: 'image/png' })).status).toBe(200);

    const vazio = await http().post('/api/ia/analisar-fotos-imovel').send({ imagens: [] });
    expect(vazio.body.message).toEqual(['Envie ao menos uma foto.']);
    const muitas = await http().post('/api/ia/analisar-fotos-imovel').send({ imagens: Array(26).fill('A') });
    expect(muitas.body.message).toEqual(['Máximo de 25 fotos por análise.']);
    const ok = await http().post('/api/ia/analisar-fotos-imovel').send({ imagens: ['A'], descricao_atual: 'x', dados_imovel: { titulo: 'T' } });
    expect(ok.status).toBe(200);

    const semNome = await http().post('/api/ia/mensagem-whatsapp').send({ messageType: 'reminder' });
    expect(semNome.status).toBe(400);
    expect(semNome.body.message).toEqual(['Nome do cliente é obrigatório.', 'Nome do cliente é obrigatório.']);
    expect((await http().post('/api/ia/mensagem-whatsapp').send({ clientName: 'Ana', messageType: 'custom', details: 'x', tone: 'formal' })).status).toBe(200);
  });

  it('descrição do imóvel e sugestão do Inbox', async () => {
    const d = await http().patch(`/api/ia/imoveis/${NAO_V4}/descricao`).send({ descricao: 'Nova' });
    expect(d.status).toBe(200);
    expect(fotos.salvarDescricao).toHaveBeenCalledWith(claims, NAO_V4, 'Nova');
    expect((await http().patch('/api/ia/imoveis/abc/descricao').send({ descricao: 'x' })).body.codigo).toBe('id_invalido');
    expect((await http().get('/api/ia/sugestao-inbox/imoveis')).body).toEqual([{ id: A, titulo: 'Casa' }]);
    const s = await http().post('/api/ia/sugestao-inbox').send({ propertyId: A, question: 'Tem vaga?' });
    expect(s.status).toBe(200);
    expect(s.body).toEqual({ suggestion: 's', propertyId: A, requiresReview: true });
  });

  it('conversas: listar, mensagens, renomear/fixar (id não v4 aceito), apagar 204', async () => {
    expect((await http().get('/api/ia/conversas')).body).toEqual([{ id: A }]);
    expect((await http().get(`/api/ia/conversas/${A}/mensagens`)).body).toEqual([{ id: 'm' }]);
    expect(conversas.mensagens).toHaveBeenCalledWith(claims, A);
    const p = await http().patch(`/api/ia/conversas/${NAO_V4}`).send({ title: 'Novo', pinned: true });
    expect(p.status).toBe(200);
    expect(conversas.alterar).toHaveBeenCalledWith(claims, NAO_V4, expect.objectContaining({ title: 'Novo', pinned: true }));
    const ruim = await http().patch(`/api/ia/conversas/${A}`).send({ pinned: 'sim' });
    expect(ruim.body.message).toEqual(['Valor inválido para fixar.']);
    expect((await http().patch(`/api/ia/conversas/${A}`).send({ corretor_id: A })).status).toBe(400);
    expect((await http().delete(`/api/ia/conversas/${A}`)).status).toBe(204);
    expect((await http().delete('/api/ia/conversas/xyz')).body).toEqual({ statusCode: 400, codigo: 'id_invalido', message: 'Identificador inválido.' });
  });
});
