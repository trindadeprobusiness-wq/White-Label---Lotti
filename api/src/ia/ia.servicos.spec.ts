import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Readable } from 'node:stream';
import { AcaoIaService } from './acao.service';
import { AnexosIaService } from './anexos.service';
import { ConversasService } from './conversas.service';
import { executarAcao } from './executar-acao';
import { FerramentasIaService } from './ferramentas.service';
import { FotosIaService, PARAMETROS_PADRAO } from './fotos.service';
import { AlterarConversaDto, AnalisarFotoDto, AnalisarFotosImovelDto, DecisaoAcaoDto, MensagemWhatsappDto, SugestaoInboxDto } from './ia.dto';
import { MensagensIaService } from './mensagens.service';

const CORRETOR = '55555555-5555-4555-8555-555555555555';
const USUARIO = '66666666-6666-4666-8666-666666666666';
const ID = '11111111-1111-4111-8111-111111111111';
const PROPOSTA = '22222222-2222-4222-8222-222222222222';
const claims = { sub: USUARIO, role: 'authenticated' };

type Resposta = unknown | ((q: Prisma.Sql) => unknown);
type Regra = [RegExp, Resposta];

function sqlFalso(regras: Regra[]) {
  const responder = (q: Prisma.Sql) => {
    for (const [re, r] of regras) if (re.test(q.text)) return typeof r === 'function' ? (r as (q: Prisma.Sql) => unknown)(q) : r;
    return [];
  };
  return {
    $queryRaw: jest.fn(async (q: Prisma.Sql) => responder(q)),
    $executeRaw: jest.fn(async (q: Prisma.Sql) => {
      responder(q);
      return 1;
    }),
  };
}

function tenant(regras: Regra[] = []) {
  const tx = sqlFalso([...regras, [/get_corretor_id/, [{ id: CORRETOR }]]]);
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, db };
}

const sqls = (m: jest.Mock, re: RegExp) => (m.mock.calls as Array<[Prisma.Sql]>).map(([q]) => q).filter((q) => re.test(q.text));
const uma = (q: Prisma.Sql) => q.text.replace(/\s+/g, ' ').trim();

async function erroDe(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

const erroPrisma = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 't', meta: { code, message: `ERROR: ${code}` } });

describe('ConversasService', () => {
  it('lista com RLS: updated_at desc nulls first, desempate por id, teto 50', async () => {
    const { tx, db } = tenant([[/from public\.ai_conversations c/, [{ linha: { id: ID } }]]]);
    expect(await new ConversasService(db as never).listar(claims)).toEqual([{ id: ID }]);
    expect(db.run.mock.calls[0][0]).toBe(claims);
    const [q] = sqls(tx.$queryRaw, /ai_conversations/);
    expect(uma(q)).toBe('select to_jsonb(c) as linha from public.ai_conversations c order by c.updated_at desc nulls first, c.id limit $1::int');
    expect(q.values).toEqual([50]);
  });

  it('alterar: só o que veio (título com trim ou pinned), 404 sem linha, 400 sem nada', async () => {
    const { tx, db } = tenant([[/update public\.ai_conversations/, [{ linha: { id: ID, title: 'Novo' } }]]]);
    const s = new ConversasService(db as never);
    expect(await s.alterar(claims, ID, Object.assign(new AlterarConversaDto(), { title: '  Novo ' }))).toEqual({ id: ID, title: 'Novo' });
    await s.alterar(claims, ID, Object.assign(new AlterarConversaDto(), { pinned: true }));
    const [titulo, fixar] = sqls(tx.$queryRaw, /update public\.ai_conversations/);
    expect(titulo.text).toMatch(/title = coalesce\(\$1::text, c\.title\)/);
    expect(titulo.text).toMatch(/pinned = coalesce\(\$2::boolean, c\.pinned\)/);
    expect(titulo.text).not.toMatch(/updated_at/);
    expect(titulo.values).toEqual(['Novo', null, ID]);
    expect(fixar.values).toEqual([null, true, ID]);
    expect((await erroDe(s.alterar(claims, ID, new AlterarConversaDto()))).body.codigo).toBe('nada_para_atualizar');
    expect((await erroDe(s.alterar(claims, ID, Object.assign(new AlterarConversaDto(), { title: '  ' })))).body.codigo).toBe('titulo_invalido');

    const vazio = tenant();
    expect((await erroDe(new ConversasService(vazio.db as never).alterar(claims, ID, Object.assign(new AlterarConversaDto(), { pinned: false })))).status).toBe(404);
  });

  it('apagar é idempotente e mensagens vêm em ordem crescente com teto 1000', async () => {
    const { tx, db } = tenant([[/from public\.ai_messages m/, [{ linha: { id: 'm1', role: 'user' } }]]]);
    const s = new ConversasService(db as never);
    await expect(s.apagar(claims, ID)).resolves.toBeUndefined();
    expect(uma(sqls(tx.$queryRaw, /delete/)[0])).toBe('delete from public.ai_conversations where id = $1::uuid returning id');
    expect(await s.mensagens(claims, ID)).toEqual([{ id: 'm1', role: 'user' }]);
    const [q] = sqls(tx.$queryRaw, /from public\.ai_messages m/);
    expect(q.text).toMatch(/order by m\.created_at asc nulls last, m\.id\s+limit \$2::int/);
    expect(q.values).toEqual([ID, 1000]);
  });

  it('erro do banco é traduzido (22P02 → 400)', async () => {
    const { db } = tenant([[/ai_conversations/, () => { throw erroPrisma('22P02'); }]]);
    expect((await erroDe(new ConversasService(db as never).listar(claims))).body.codigo).toBe('dados_invalidos');
  });
});

describe('FerramentasIaService', () => {
  const ctx = { claims, runId: 'run-1', corretorId: CORRETOR, userId: USUARIO, entityRefs: [{ type: 'cliente', id: 'c1' }] };

  function montar(regras: Regra[] = [], prismaRegras: Regra[] = []) {
    const { tx, db } = tenant(regras);
    const prisma = sqlFalso(prismaRegras);
    return { tx, db, prisma, s: new FerramentasIaService(db as never, prisma as never) };
  }

  it('leituras rodam no TenantDb com as claims (RLS) e com os filtros parametrizados', async () => {
    const m = montar([[/from public\.clientes c/, [{ linha: { id: ID, nome: 'Ana' } }]]]);
    expect(JSON.parse(await m.s.executar('search_clients', { query: 'Ana%', status_funil: 'QUALIFICACAO', limit: 99 }, ctx))).toEqual([{ id: ID, nome: 'Ana' }]);
    expect(m.db.run.mock.calls[0][0]).toBe(claims);
    const [q] = sqls(m.tx.$queryRaw, /from public\.clientes c/);
    expect(q.text).toMatch(/c\.nome ilike \$2::text or c\.email ilike \$3::text or c\.telefone ilike \$4::text/);
    expect(q.text).toMatch(/c\.status_funil::text = \$6::text/);
    expect(q.text).toMatch(/order by c\.created_at desc nulls first, c\.id\s+limit \$9::int/);
    expect(q.values).toEqual(['Ana ', '%Ana %', '%Ana %', '%Ana %', 'QUALIFICACAO', 'QUALIFICACAO', null, null, 25]);
  });

  it('imóveis, financeiro, contratos, alertas, funil e histórico', async () => {
    const m = montar([
      [/from public\.imoveis i/, [{ linha: { id: ID } }]],
      [/sum\(l\.valor\)/, [{ receita: 1000, despesa: 250.5, total: 3 }]],
      [/from public\.lancamentos_financeiros l\s+where \(/, [{ linha: { id: 'l1' } }]],
      [/from public\.contratos c/, []],
      [/from public\.alertas a/, []],
      [/group by 1/, [{ status: 'QUALIFICACAO', n: 2 }, { status: 'FECHADO_GANHO', n: 1 }]],
      [/from public\.historico_contatos h/, [{ linha: { id: 'h1' } }]],
    ]);
    await m.s.executar('search_properties', { cidade: 'Anápolis', preco_min: 0, preco_max: '500000', tipo: 'CASA' }, ctx);
    const [imoveis] = sqls(m.tx.$queryRaw, /from public\.imoveis i/);
    expect(imoveis.values).toEqual(['', '%%', '%%', 'CASA', 'CASA', '%Anápolis%', '%Anápolis%', null, null, 500000, 500000, 10]);
    expect(imoveis.text).toMatch(/i\.valor <= \$11::numeric/);

    expect(JSON.parse(await m.s.executar('get_financial_summary', { period: 'year' }, ctx))).toEqual({
      period: 'year', receita: 1000, despesa: 250.5, saldo: 749.5, total_lancamentos: 3,
    });
    expect(sqls(m.tx.$queryRaw, /sum\(l\.valor\)/)[0].values[0]).toMatch(/^\d{4}-01-01$/);

    await m.s.executar('get_financial_entries', { tipo: 'DESPESA', date_from: '2026-01-01' }, ctx);
    const [lanc] = sqls(m.tx.$queryRaw, /from public\.lancamentos_financeiros l\s+where \(/);
    expect(lanc.text).toMatch(/l\.data >= \$6::timestamptz/);
    expect(lanc.values.at(-1)).toBe(20);

    await m.s.executar('get_alerts', { prioridade: 'ALTA' }, ctx);
    expect(sqls(m.tx.$queryRaw, /from public\.alertas a/)[0].text).toMatch(/a\.metadata->>'prioridade' = \$4::text/);
    expect(JSON.parse(await m.s.executar('get_funnel_stats', {}, ctx))).toEqual({ total: 3, by_status: { QUALIFICACAO: 2, FECHADO_GANHO: 1 } });
    expect(JSON.parse(await m.s.executar('get_contact_history', { client_id: ID }, ctx))).toEqual([{ id: 'h1' }]);
    expect(sqls(m.tx.$queryRaw, /from public\.historico_contatos h/)[0].text).toMatch(/order by h\.data_contato desc, h\.id limit 20/);
    expect(JSON.parse(await m.s.executar('get_contact_history', { client_id: 'x' }, ctx))).toEqual({ error: 'invalid_client_id' });
    expect(JSON.parse(await m.s.executar('nao_existe', {}, ctx))).toEqual({ error: 'Unknown tool: nao_existe' });
  });

  it('erro do banco numa leitura volta como { error } para o modelo', async () => {
    const m = montar([[/from public\.lancamentos_financeiros/, () => { throw erroPrisma('22007'); }]]);
    expect(JSON.parse(await m.s.executar('get_financial_entries', { date_from: 'ontem' }, ctx))).toEqual({ error: 'query_failed' });
  });

  it('suggest_action grava a proposta pelo caminho privilegiado e devolve a ação pendente', async () => {
    const m = montar();
    const r = JSON.parse(await m.s.executar('suggest_action', {
      action_type: 'create_alert', params: { mensagem: ' Ligar para Ana ', prioridade: 'ALTA' }, description: 'Criar alerta',
    }, ctx));
    expect(r).toEqual({
      type: 'action',
      action: { id: expect.any(String), action_type: 'create_alert', params: { mensagem: 'Ligar para Ana', prioridade: 'ALTA' }, description: 'Criar alerta', status: 'pending' },
    });
    expect(m.db.run).not.toHaveBeenCalled();
    const [q] = sqls(m.prisma.$executeRaw, /insert into public\.ai_action_proposals/);
    expect(q.values.slice(0, 5)).toEqual([r.action.id, 'run-1', CORRETOR, USUARIO, 'create_alert']);
    expect(JSON.parse(q.values[5] as string)).toEqual([{ type: 'cliente', id: 'c1' }]);
    expect(JSON.parse(q.values[6] as string)).toEqual({ action_type: 'create_alert', description: 'Criar alerta', fields: ['mensagem', 'prioridade'] });
  });

  it('suggest_action inválida ou sem tabela de propostas: erros da função', async () => {
    const m = montar([], [[/ai_action_proposals/, () => { throw erroPrisma('42P01'); }]]);
    expect(JSON.parse(await m.s.executar('suggest_action', { action_type: 'apagar_tudo' }, ctx)).error).toBe('invalid_action_schema');
    expect(JSON.parse(await m.s.executar('suggest_action', { action_type: 'create_alert', params: { mensagem: 'x' }, description: 'd' }, ctx))).toEqual({
      error: 'action_persistence_unavailable', message: 'A ação não pôde ser preparada com segurança. Tente novamente.',
    });
  });
});

describe('AcaoIaService', () => {
  const futuro = new Date(Date.now() + 60_000).toISOString();
  const payload = { action_type: 'create_alert', params: { mensagem: 'Ligar' }, description: 'Criar alerta' };

  function montar(proposta: Record<string, unknown> | null, regras: Regra[] = []) {
    const { tx, db } = tenant([...regras, [/insert into public\.alertas/, [{ id: ID }]]]);
    const prisma = sqlFalso([
      [/set status = 'confirmed'/, proposta ? [{ ...proposta, status: 'confirmed' }] : []],
      [/from public\.ai_action_proposals/, proposta ? [proposta] : []],
    ]);
    return { tx, db, prisma, s: new AcaoIaService(db as never, prisma as never) };
  }
  const dto = (decision: 'confirm' | 'reject') => Object.assign(new DecisaoAcaoDto(), { proposal_id: PROPOSTA, decision });

  it('confirmar: lê filtrando corretor e usuário, trava, executa no TenantDb e marca executed', async () => {
    const m = montar({ id: PROPOSTA, status: 'pending', expires_at: futuro, payload });
    expect(await m.s.decidir(claims, dto('confirm'))).toEqual({ status: 'executed', proposal_id: PROPOSTA, record_id: ID });
    const [leitura] = sqls(m.prisma.$queryRaw, /from public\.ai_action_proposals/);
    expect(leitura.text).toMatch(/where id = \$1::uuid and corretor_id = \$2::uuid and user_id = \$3::uuid/);
    expect(leitura.values).toEqual([PROPOSTA, CORRETOR, USUARIO]);
    expect(sqls(m.prisma.$queryRaw, /set status = 'confirmed'/)[0].text).toMatch(/status = 'pending' and expires_at > now\(\)/);
    expect(m.db.run.mock.calls.every(([c]) => c === claims)).toBe(true);
    const [alerta] = sqls(m.tx.$queryRaw, /insert into public\.alertas/);
    expect(alerta.values).toEqual(['Ligar', 'GERAL', CORRETOR, JSON.stringify({ prioridade: 'MEDIA' })]);
    expect(sqls(m.prisma.$executeRaw, /set status = 'executed'/)).toHaveLength(1);
  });

  it('recusar, idempotência, expirada, não encontrada e sem corretor', async () => {
    const pendente = montar({ id: PROPOSTA, status: 'pending', expires_at: futuro, payload });
    expect(await pendente.s.decidir(claims, dto('reject'))).toEqual({ status: 'rejected', proposal_id: PROPOSTA });
    expect(sqls(pendente.prisma.$executeRaw, /set status = 'rejected'/)[0].text).toMatch(/status = 'pending'/);

    const executada = montar({ id: PROPOSTA, status: 'executed', expires_at: futuro, payload });
    expect(await executada.s.decidir(claims, dto('confirm'))).toEqual({ status: 'executed', proposal_id: PROPOSTA, idempotent: true });
    expect((await erroDe(executada.s.decidir(claims, dto('reject')))).body).toEqual({ statusCode: 409, codigo: 'proposta_processada', message: 'A proposta já foi processada.' });

    const vencida = montar({ id: PROPOSTA, status: 'pending', expires_at: new Date(Date.now() - 1000).toISOString(), payload });
    expect((await erroDe(vencida.s.decidir(claims, dto('confirm')))).body.message).toBe('A proposta expirou ou já foi processada.');

    const nenhuma = montar(null);
    expect((await erroDe(nenhuma.s.decidir(claims, dto('confirm')))).body).toEqual({ statusCode: 404, codigo: 'proposta_nao_encontrada', message: 'Proposta não encontrada.' });

    const semConta = montar(null, [[/get_corretor_id/, [{ id: null }]]]);
    expect((await erroDe(semConta.s.decidir(claims, dto('confirm')))).body.message).toBe('Corretor não encontrado.');
  });

  it('falha na execução: marca failed e responde o 500 genérico da função', async () => {
    const m = montar({ id: PROPOSTA, status: 'pending', expires_at: futuro, payload }, [[/insert into public\.alertas/, () => { throw erroPrisma('42501'); }]]);
    expect(await erroDe(m.s.decidir(claims, dto('confirm')))).toEqual({
      status: 500, body: { statusCode: 500, codigo: 'acao_nao_executada', message: 'A ação não foi executada. Revise os dados e tente novamente.' },
    });
    expect(sqls(m.prisma.$executeRaw, /set status = 'failed', error_code = 'execution_failed'/)).toHaveLength(1);
  });
});

describe('executarAcao (dentro do TenantDb)', () => {
  const rodar = async (action_type: string, params: Record<string, unknown>, regras: Regra[] = []) => {
    const tx = sqlFalso(regras);
    const r = await executarAcao(tx as never, CORRETOR, { action_type: action_type as never, params, description: 'd' });
    return { r, tx };
  };

  it('create_client: crm_criar_cliente; telefone repetido devolve o existente', async () => {
    const criado = await rodar('create_client', { nome: 'Ana', telefone: '' }, [[/crm_criar_cliente/, [{ r: { status: 'created', cliente_id: ID } }]]]);
    expect(criado.r).toEqual({ record_id: ID });
    expect(JSON.parse(sqls(criado.tx.$queryRaw, /crm_criar_cliente/)[0].values[0] as string)).toEqual({ nome: 'Ana', telefone: '', tipo_interesse: 'COMPRA' });
    const repetido = await rodar('create_client', { nome: 'Ana', telefone: '62999' }, [[/crm_criar_cliente/, [{ r: { status: 'duplicate', candidatos: [{ id: ID }] } }]]]);
    expect(repetido.r).toEqual({ record_id: ID, existing: true });
  });

  it('status, follow-up, contato, imóvel e lançamento com corretor explícito e casts', async () => {
    const st = await rodar('update_client_status', { client_id: ID, status: 'DOCUMENTACAO' }, [[/update public\.clientes/, [{ id: ID }]]]);
    expect(uma(sqls(st.tx.$queryRaw, /update/)[0])).toBe(
      'update public.clientes set status_funil = $1::public.status_funil where id = $2::uuid and corretor_id = $3::uuid returning id::text as id');
    await expect(rodar('schedule_followup', { client_id: ID, date: '2026-10-10' })).rejects.toThrow('client_not_authorized');

    const contato = await rodar('register_contact', { client_id: ID, tipo: 'ligacao', descricao: 'Falei' }, [
      [/select id::text as id from public\.clientes/, [{ id: ID }]],
      [/insert into public\.historico_contatos/, [{ id: 'h1' }]],
    ]);
    expect(contato.r).toEqual({ record_id: 'h1' });
    expect(sqls(contato.tx.$queryRaw, /historico_contatos/)[0].values).toEqual([ID, 'TELEFONE', 'Falei', JSON.stringify({ tipo_ui: 'LIGACAO', origem: 'lotti_ai' })]);

    const imovel = await rodar('create_property', { titulo: 'Apto', valor: 300000 }, [[/insert into public\.imoveis/, [{ id: 'i1' }]]]);
    expect(sqls(imovel.tx.$queryRaw, /imoveis/)[0].values).toEqual(['Apto', 'APARTAMENTO', 300000, 0, 0, 0, '', '', '', '', CORRETOR]);

    const lanc = await rodar('create_financial_entry', { tipo: 'RECEITA', categoria: 'CONSULTORIA', descricao: 'x', valor: 10, data: '2026-10-01' }, [
      [/insert into public\.lancamentos_financeiros/, [{ id: 'l1' }]],
    ]);
    expect(sqls(lanc.tx.$queryRaw, /lancamentos/)[0].values).toEqual(['RECEITA', 'CONSULTORIA', 'x', 10, '2026-10-01', false, CORRETOR]);
  });
});

describe('AnexosIaService', () => {
  function montar(regras: Regra[] = []) {
    const { tx, db } = tenant(regras);
    const storage = { enviar: jest.fn(async (_b: string, _k: string, corpo: Readable) => { for await (const _ of corpo) { /* consome */ } }) };
    const s = new AnexosIaService(db as never, storage as never);
    s.agora = () => 1700000000000;
    return { tx, db, storage, s };
  }
  const arquivo = (nome: string, mime: string, conteudo: string | Buffer) => {
    const buffer = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo);
    return { originalname: nome, mimetype: mime, size: buffer.length, buffer };
  };

  it('sobe no ai-attachments com a key <user>/<epoch>.<ext> e devolve o formato da função', async () => {
    const m = montar();
    const r = await m.s.processar(claims, arquivo('notas.txt', 'text/plain', 'Olá, mundo'));
    expect(m.storage.enviar).toHaveBeenCalledWith('ai-attachments', `${USUARIO}/1700000000000.txt`, expect.any(Readable), 'text/plain');
    expect(r).toEqual({
      storage_path: `${USUARIO}/1700000000000.txt`, extracted_text: 'Olá, mundo', metadata: {}, file_name: 'notas.txt', file_type: 'text/plain', file_size: 11,
    });
    expect(m.db.run).not.toHaveBeenCalled();
  });

  it('com message_id grava ai_attachments no TenantDb; falha desse insert é ignorada', async () => {
    const m = montar([[/insert into public\.ai_attachments/, () => { throw erroPrisma('42501'); }]]);
    const r = await m.s.processar(claims, arquivo('foto.png', 'image/png', 'png'), ID);
    expect(r.metadata).toEqual({ storage_path: `${USUARIO}/1700000000000.png`, width: 0, height: 0 });
    const [q] = sqls(m.tx.$executeRaw, /ai_attachments/);
    expect(q.values.slice(0, 5)).toEqual([ID, 'foto.png', 'image/png', 3, `${USUARIO}/1700000000000.png`]);
  });

  it('recusa sem arquivo, tipo fora da lista e storage indisponível passa intacto', async () => {
    const m = montar();
    expect((await erroDe(m.s.processar(claims, undefined))).body.codigo).toBe('arquivo_ausente');
    expect((await erroDe(m.s.processar(claims, arquivo('x.exe', 'application/x-msdownload', 'MZ')))).body.codigo).toBe('tipo_nao_permitido');
    m.storage.enviar.mockRejectedValueOnce(new HttpException({ statusCode: 503, codigo: 'storage_indisponivel', message: 'x' }, 503));
    expect((await erroDe(m.s.processar(claims, arquivo('a.pdf', 'application/pdf', '(texto)')))).status).toBe(503);
    m.storage.enviar.mockRejectedValueOnce(new Error('s3'));
    expect((await erroDe(m.s.processar(claims, arquivo('a.pdf', 'application/pdf', '(texto)')))).body.codigo).toBe('envio_falhou');
  });
});

describe('FotosIaService', () => {
  const ambiente = { ...process.env };
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'chave-falsa';
    delete process.env.LOTTI_AI_FAST_MODEL;
  });
  afterAll(() => {
    process.env = ambiente;
  });
  const conteudo = (texto: string, status = 200) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }), { status });
  function montar() {
    const { tx, db } = tenant([[/update public\.imoveis/, [{ id: ID, descricao: 'Nova' }]]]);
    const s = new FotosIaService(db as never);
    const fetchImpl = jest.fn();
    s.fetchImpl = fetchImpl as never;
    return { tx, db, s, fetchImpl };
  }

  it('analisar-foto: prompt versionado, inline_data, sem thinking, 1 retentativa; resposta limitada', async () => {
    const m = montar();
    m.fetchImpl.mockResolvedValueOnce(new Response('x', { status: 503 })).mockResolvedValueOnce(conteudo('```json\n{"brightness":2,"contrast":1.1}\n```'));
    const r = await m.s.analisarFoto(Object.assign(new AnalisarFotoDto(), { imageBase64: 'QUJD', mimeType: 'image/png' }));
    expect(r.params).toEqual({ ...PARAMETROS_PADRAO, brightness: 1.3, contrast: 1.1 });
    expect(m.fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = m.fetchImpl.mock.calls[1];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=chave-falsa');
    const corpo = JSON.parse(init.body);
    expect(corpo.contents[0].parts[0].text).toMatch(/real estate photo editor[\s\S]*Prompt version: media\.photo-enhancement@2026-08-20\.1$/);
    expect(corpo.contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'image/png', data: 'QUJD' } });
    expect(corpo.generationConfig).toEqual({ response_mime_type: 'application/json', temperature: 0.2, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 2048 });
  });

  it('analisar-foto é resiliente: sem chave, erro ou JSON ruim devolvem os padrões', async () => {
    const m = montar();
    m.fetchImpl.mockResolvedValueOnce(conteudo('não é json'));
    expect((await m.s.analisarFoto(Object.assign(new AnalisarFotoDto(), { imageBase64: 'Q', mimeType: 'image/jpeg' }))).params).toEqual(PARAMETROS_PADRAO);
    process.env.GEMINI_API_KEY = '';
    expect((await m.s.analisarFoto(Object.assign(new AnalisarFotoDto(), { imageBase64: 'Q', mimeType: 'image/jpeg' }))).params).toEqual(PARAMETROS_PADRAO);
    expect(m.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('analisar-fotos-imovel: uma chamada com todas as fotos e o contexto; erros 502', async () => {
    const m = montar();
    m.fetchImpl.mockResolvedValueOnce(conteudo('Aqui: {"fotos":[{"indice":0,"categoria":"SALA"}],"descricao_sugerida":"Casa clara."}'));
    const dto = Object.assign(new AnalisarFotosImovelDto(), { imagens: ['A', 'B'], descricao_atual: 'Casa', dados_imovel: { titulo: 'Casa Centro', cidade: 'Goiânia', tipo: 5 } });
    expect(await m.s.analisarFotosImovel(dto)).toEqual({ fotos: [{ indice: 0, categoria: 'SALA' }, { indice: 1, categoria: 'OUTRO' }], descricao_sugerida: 'Casa clara.' });
    const corpo = JSON.parse(m.fetchImpl.mock.calls[0][1].body);
    expect(corpo.contents[0].parts).toHaveLength(3);
    expect(corpo.contents[0].parts[0].text).toMatch(/Prompt version: properties\.photo-classification@2026-08-20\.1\n\nDados do imóvel:\nTítulo: Casa Centro\nCidade: Goiânia\nDescrição atual: Casa$/);
    expect(corpo.contents[0].parts[2]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: 'B' } });
    expect(corpo.generationConfig.maxOutputTokens).toBe(4096);

    m.fetchImpl.mockResolvedValueOnce(new Response('x', { status: 500 }));
    expect((await erroDe(m.s.analisarFotosImovel(dto))).body).toEqual({ statusCode: 502, codigo: 'ia_falhou', message: 'Falha ao analisar as fotos com a IA' });
    m.fetchImpl.mockResolvedValueOnce(conteudo('sem json'));
    expect((await erroDe(m.s.analisarFotosImovel(dto))).body.message).toBe('A IA não conseguiu estruturar a análise das fotos');
  });

  it('salvar descrição: só a coluna descricao, no TenantDb', async () => {
    const m = montar();
    expect(await m.s.salvarDescricao(claims, ID, 'Nova')).toEqual({ id: ID, descricao: 'Nova' });
    expect(m.db.run.mock.calls[0][0]).toBe(claims);
    expect(uma(sqls(m.tx.$queryRaw, /update/)[0])).toBe('update public.imoveis set descricao = $1::text where id = $2::uuid returning id::text as id, descricao');
  });
});

describe('MensagensIaService', () => {
  const ambiente = { ...process.env };
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'chave-falsa';
    delete process.env.LOTTI_AI_FAST_MODEL;
  });
  afterAll(() => {
    process.env = ambiente;
  });
  const chat = (conteudo: unknown, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), { status });
  function montar(regras: Regra[] = [], prismaRegras: Regra[] = []) {
    const { tx, db } = tenant([...regras, [/from public\.imoveis i/, [{ linha: { id: ID, titulo: 'Casa', valor: 1, proprietario_nome: 'X' } }]]]);
    const prisma = sqlFalso([...prismaRegras, [/ai_rate_limits/, [{ permitido: true }]], [/checar_cota/, [{ permitido: true }]]]);
    const s = new MensagensIaService(db as never, prisma as never);
    const fetchImpl = jest.fn();
    s.fetchImpl = fetchImpl as never;
    return { tx, db, prisma, s, fetchImpl };
  }

  it('WhatsApp: prompts da função, temperatura 0.4, reasoning_effort none, 429/402 com os textos', async () => {
    const m = montar();
    m.fetchImpl.mockResolvedValueOnce(chat('Olá Ana! 😊'));
    const dto = Object.assign(new MensagemWhatsappDto(), { clientName: 'Ana', messageType: 'reminder', tone: 'friendly', details: { amount: 'R$ 1.500,00' } });
    expect(await m.s.gerarWhatsapp(dto)).toEqual({ message: 'Olá Ana! 😊', model: 'gemini-2.5-flash', prompt_version: 'rentals.whatsapp@2026-08-20.1' });
    const corpo = JSON.parse(m.fetchImpl.mock.calls[0][1].body);
    expect(corpo).toMatchObject({ temperature: 0.4, reasoning_effort: 'none', model: 'gemini-2.5-flash' });
    expect(corpo.messages[0].content).toMatch(/^Você é um assistente profissional de corretor de imóveis\.[\s\S]*Versão: rentals\.whatsapp@2026-08-20\.1$/);
    expect(corpo.messages[1].content).toContain('"messageType":"Lembrete de Vencimento","tone":"Amigável"');

    m.fetchImpl.mockResolvedValue(chat('', 429));
    expect((await erroDe(m.s.gerarWhatsapp(dto))).body.message).toBe('Limite de requisições excedido. Tente novamente em alguns segundos.');
    m.fetchImpl.mockResolvedValue(chat('', 402));
    expect((await erroDe(m.s.gerarWhatsapp(dto))).body.message).toBe('Créditos de IA esgotados. Adicione créditos ao workspace.');
    expect((await erroDe(m.s.gerarWhatsapp(Object.assign(new MensagemWhatsappDto(), { clientName: '  ' })))).body.message).toBe('Nome do cliente é obrigatório.');
  });

  it('imóveis do seletor: só ativos da conta, por título, teto 200', async () => {
    const m = montar([[/select i\.id::text as id, i\.titulo/, [{ id: ID, titulo: 'Casa' }]]]);
    expect(await m.s.imoveisParaSugestao(claims)).toEqual([{ id: ID, titulo: 'Casa' }]);
    const [q] = sqls(m.tx.$queryRaw, /i\.titulo from public\.imoveis/);
    expect(q.text).toMatch(/where i\.corretor_id = \$1::uuid and i\.ativo = true\s+order by i\.titulo asc, i\.id limit \$2::int/);
    expect(q.values).toEqual([CORRETOR, 200]);
    const semConta = montar([[/get_corretor_id/, [{ id: null }]]]);
    expect((await erroDe(semConta.s.imoveisParaSugestao(claims))).status).toBe(403);
  });

  it('sugestão do Inbox: cadastro público, limite 10/min, cota ai_assistant_monthly e uso contado', async () => {
    const m = montar();
    m.fetchImpl.mockResolvedValueOnce(chat('  Sim, tem 2 vagas.  '));
    const dto = Object.assign(new SugestaoInboxDto(), { propertyId: ID, question: 'Tem garagem?' });
    expect(await m.s.sugerirResposta(claims, dto)).toEqual({ suggestion: 'Sim, tem 2 vagas.', propertyId: ID, requiresReview: true });
    const [imovel] = sqls(m.tx.$queryRaw, /from public\.imoveis i/);
    expect(imovel.text).toMatch(/jsonb_build_object\('id', i\.id, 'titulo', i\.titulo,[\s\S]*'ativo', i\.ativo\)/);
    expect(imovel.text).toMatch(/i\.id = \$1::uuid and i\.corretor_id = \$2::uuid and i\.ativo = true/);
    expect(sqls(m.prisma.$queryRaw, /ai_rate_limits/)[0].values).toEqual([CORRETOR, 10]);
    expect(sqls(m.prisma.$queryRaw, /checar_cota/)[0].values).toEqual([CORRETOR, 'ai_assistant_monthly']);
    expect(sqls(m.prisma.$executeRaw, /incrementar_uso/)[0].values).toEqual([CORRETOR, 'ai_assistant_monthly', 1]);
    const corpo = JSON.parse(m.fetchImpl.mock.calls[0][1].body);
    expect(corpo).toMatchObject({ temperature: 0.2, max_tokens: 500 });
    expect(JSON.parse(corpo.messages[1].content)).toEqual({ cadastro: { id: ID, titulo: 'Casa', valor: 1 }, pergunta: 'Tem garagem?' });
  });

  it('sugestão do Inbox: entrada, imóvel, limite, cota e IA com os status da função', async () => {
    const dto = Object.assign(new SugestaoInboxDto(), { propertyId: ID, question: 'Tem garagem?' });
    expect((await erroDe(montar().s.sugerirResposta(claims, Object.assign(new SugestaoInboxDto(), { propertyId: 'x', question: 'a' })))).body.message)
      .toBe('Selecione um imóvel e informe uma pergunta de até 2.000 caracteres.');
    expect((await erroDe(montar([[/from public\.imoveis i/, []]]).s.sugerirResposta(claims, dto))).status).toBe(404);
    expect((await erroDe(montar([[/from public\.imoveis i/, () => { throw erroPrisma('XX000'); }]]).s.sugerirResposta(claims, dto))).status).toBe(503);
    expect((await erroDe(montar([], [[/ai_rate_limits/, [{ permitido: false }]]]).s.sugerirResposta(claims, dto))).body.message).toBe('Aguarde um minuto para tentar novamente.');
    expect((await erroDe(montar([], [[/ai_rate_limits/, () => { throw new Error('x'); }]]).s.sugerirResposta(claims, dto))).status).toBe(429);
    expect((await erroDe(montar([], [[/checar_cota/, [{ permitido: false }]]]).s.sugerirResposta(claims, dto))).body.message).toBe('Cota de IA indisponível para esta conta.');
    const ia = montar();
    ia.fetchImpl.mockResolvedValueOnce(chat('', 500));
    expect((await erroDe(ia.s.sugerirResposta(claims, dto))).body.message).toBe('IA indisponível. Tente novamente mais tarde.');
    ia.fetchImpl.mockResolvedValueOnce(chat('   '));
    expect((await erroDe(ia.s.sugerirResposta(claims, dto))).status).toBe(502);
    expect(sqls(ia.prisma.$executeRaw, /incrementar_uso/)).toHaveLength(0);
  });
});
