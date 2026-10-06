import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chamarApi = vi.hoisted(() => vi.fn());
const obterTokenApi = vi.hoisted(() => vi.fn(async () => 'tok-api'));
vi.mock('@/lib/api', () => ({ chamarApi, obterTokenApi, apiDisponivel: () => true }));

const BASE = 'https://api.exemplo.com';
const ID = '11111111-1111-4111-8111-111111111111';

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', `${BASE}/`);
  return import('./ia');
}

const json = (corpo: unknown, status = 200) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });
const chamada = (i = 0) => ({
  caminho: chamarApi.mock.calls[i][0] as string,
  init: (chamarApi.mock.calls[i][1] ?? {}) as RequestInit & { headers?: Record<string, string> },
});

describe('API de IA no front', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    chamarApi.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('assistente: fetch próprio com o token do login da API no cabeçalho e Accept SSE; devolve o stream', async () => {
    const api = await carregar();
    const stream = new Response('data: {"type":"done"}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    fetchMock.mockResolvedValueOnce(stream);
    const sinal = new AbortController().signal;
    expect(await api.abrirAssistenteApi({ message: 'oi', conversation_id: null }, sinal)).toBe(stream);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`${BASE}/api/ia/assistente`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok-api', 'Content-Type': 'application/json', Accept: 'text/event-stream' });
    expect(JSON.parse(init.body as string)).toEqual({ message: 'oi', conversation_id: null });
    expect(init.signal).toBe(sinal);
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('assistente: erro antes do stream vira ErroApi com o texto da API (500 usa o padrão)', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({ statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', message: 'Seu plano atual não inclui o Assistente Lotti.' }, 402));
    await expect(api.abrirAssistenteApi({ message: 'oi' })).rejects.toMatchObject({ status: 402, codigo: 'PLAN_LIMIT_REACHED', message: 'Seu plano atual não inclui o Assistente Lotti.' });
    fetchMock.mockResolvedValueOnce(json({ statusCode: 500, message: 'x' }, 500));
    await expect(api.abrirAssistenteApi({ message: 'oi' })).rejects.toMatchObject({ message: 'O assistente não respondeu. Tente novamente.' });
  });

  it('conversas: listar, mensagens, renomear/fixar e apagar nos caminhos da API', async () => {
    const api = await carregar();
    chamarApi.mockImplementation(async (caminho: string, init?: RequestInit) => (init?.method === 'DELETE' ? json(undefined, 204) : json(caminho.endsWith('mensagens') ? [{ id: 'm' }] : [{ id: ID }])));
    expect(await api.listarConversasIaApi()).toEqual([{ id: ID }]);
    expect(await api.listarMensagensIaApi(ID)).toEqual([{ id: 'm' }]);
    await api.alterarConversaIaApi(ID, { pinned: true });
    await expect(api.apagarConversaIaApi(ID)).resolves.toBeUndefined();
    expect(chamarApi.mock.calls.map((c) => [c[0], (c[1] as RequestInit | undefined)?.method])).toEqual([
      ['/api/ia/conversas', undefined],
      [`/api/ia/conversas/${ID}/mensagens`, undefined],
      [`/api/ia/conversas/${ID}`, 'PATCH'],
      [`/api/ia/conversas/${ID}`, 'DELETE'],
    ]);
    expect(JSON.parse(chamada(2).init.body as string)).toEqual({ pinned: true });
  });

  it('ação: POST /api/ia/acao com proposal_id e decision; erro traz o texto da API', async () => {
    const api = await carregar();
    chamarApi.mockResolvedValueOnce(json({ status: 'executed', proposal_id: ID, record_id: 'c1', existing: true }));
    expect(await api.decidirAcaoIaApi(ID, 'confirm')).toEqual({ status: 'executed', proposal_id: ID, record_id: 'c1', existing: true });
    expect(chamada().caminho).toBe('/api/ia/acao');
    expect(JSON.parse(chamada().init.body as string)).toEqual({ proposal_id: ID, decision: 'confirm' });
    chamarApi.mockResolvedValueOnce(json({ statusCode: 409, codigo: 'proposta_processada', message: 'A proposta já foi processada.' }, 409));
    await expect(api.decidirAcaoIaApi(ID, 'reject')).rejects.toThrow('A proposta já foi processada.');
  });

  it('anexo: multipart com o File no campo file e sem Content-Type manual', async () => {
    const api = await carregar();
    chamarApi.mockResolvedValueOnce(json({ storage_path: 'u/1.pdf', extracted_text: 'x', metadata: {}, file_name: 'a.pdf', file_type: 'application/pdf', file_size: 1 }));
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    expect((await api.enviarAnexoIaApi(file)).storage_path).toBe('u/1.pdf');
    const { caminho, init } = chamada();
    expect(caminho).toBe('/api/ia/anexos');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get('file')).toBeInstanceOf(File);
    expect((form.get('file') as File).name).toBe('a.pdf');
    expect(form.get('message_id')).toBeNull();
  });

  it('fotos, descrição, WhatsApp e sugestão do Inbox mandam o mesmo corpo das funções', async () => {
    const api = await carregar();
    chamarApi.mockImplementation(async () => json({ ok: true }));
    await api.analisarFotoApi({ imageBase64: 'QUJD', mimeType: 'image/jpeg' });
    await api.analisarFotosImovelApi({ imagens: ['A'], descricao_atual: 'x', dados_imovel: { titulo: 'T' } });
    await api.salvarDescricaoImovelApi(ID, 'Nova');
    await api.gerarMensagemWhatsappApi({ clientName: 'Ana', messageType: 'reminder', tone: 'friendly', details: { amount: 'R$ 1' } });
    await api.listarImoveisSugestaoApi();
    await api.sugerirRespostaInboxApi({ propertyId: ID, question: 'Tem vaga?' });
    expect(chamarApi.mock.calls.map((c) => [c[0], (c[1] as RequestInit | undefined)?.method])).toEqual([
      ['/api/ia/analisar-foto', 'POST'],
      ['/api/ia/analisar-fotos-imovel', 'POST'],
      [`/api/ia/imoveis/${ID}/descricao`, 'PATCH'],
      ['/api/ia/mensagem-whatsapp', 'POST'],
      ['/api/ia/sugestao-inbox/imoveis', undefined],
      ['/api/ia/sugestao-inbox', 'POST'],
    ]);
    expect(JSON.parse(chamada(0).init.body as string)).toEqual({ imageBase64: 'QUJD', mimeType: 'image/jpeg' });
    expect(JSON.parse(chamada(2).init.body as string)).toEqual({ descricao: 'Nova' });
    expect(JSON.parse(chamada(3).init.body as string)).toEqual({ clientName: 'Ana', messageType: 'reminder', tone: 'friendly', details: { amount: 'R$ 1' } });
    expect(JSON.parse(chamada(5).init.body as string)).toEqual({ propertyId: ID, question: 'Tem vaga?' });
    expect(chamada(0).init.headers).toEqual({ 'Content-Type': 'application/json' });
  });
});
