// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from, auth: { getSession } } }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn(), obterTokenApi: vi.fn() }));
vi.mock('@/lib/api/ia', () => ({
  abrirAssistenteApi: vi.fn(),
  alterarConversaIaApi: vi.fn(),
  apagarConversaIaApi: vi.fn(),
  decidirAcaoIaApi: vi.fn(),
  enviarAnexoIaApi: vi.fn(),
  listarConversasIaApi: vi.fn(),
  listarMensagensIaApi: vi.fn(),
}));

import * as ia from '@/lib/api/ia';
import { ErroApi } from '@/lib/api/http';
import { useAIChat } from './useAIChat';

const m = vi.mocked(ia);
const CONV = '11111111-1111-4111-8111-111111111111';
const OUTRA = '22222222-2222-4222-8222-222222222222';

const sse = (...eventos: unknown[]) => new Response(eventos.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200 });
const conversa = (id: string, pinned: boolean) => ({ id, title: id, pinned, updated_at: '2026-10-06T12:00:00Z', created_at: '2026-10-06T12:00:00Z', corretor_id: 'c', model: 'm', total_tokens: 0 });
const acao = { id: OUTRA, action_type: 'create_client' as const, params: { nome: 'Ana' }, description: 'Cadastrar Ana', status: 'pending' as const };

beforeEach(() => {
  vi.clearAllMocks();
  m.listarConversasIaApi.mockResolvedValue([conversa(OUTRA, false), conversa(CONV, true)]);
});

describe('useAIChat com a API Lotti', () => {
  it('lista conversas pela API (fixadas primeiro) e nunca toca no Supabase', async () => {
    const { result } = renderHook(() => useAIChat());
    await act(() => result.current.loadConversations());
    expect(result.current.conversations.map((c) => c.id)).toEqual([CONV, OUTRA]);
    expect(from).not.toHaveBeenCalled();
  });

  it('envia pelo stream da API: texto, ação proposta e done com a conversa', async () => {
    m.abrirAssistenteApi.mockResolvedValueOnce(sse(
      { type: 'text', content: 'Vou ' },
      { type: 'text', content: 'cadastrar.' },
      { type: 'action', action: acao },
      { type: 'done', conversation_id: CONV, trace_id: 't', prompt_version: 'v' },
    ));
    const { result } = renderHook(() => useAIChat());
    await act(() => result.current.sendMessage('Cadastre a Ana', 'texto do arquivo'));
    const [corpo, sinal] = m.abrirAssistenteApi.mock.calls[0];
    expect(corpo).toMatchObject({ message: 'Cadastre a Ana', conversation_id: null, file_context: 'texto do arquivo', intent: 'assistant.chat', output_mode: 'text', locale: 'pt-BR' });
    expect(sinal).toBeInstanceOf(AbortSignal);
    expect(result.current.messages.map((x) => [x.role, x.content])).toEqual([['user', 'Cadastre a Ana'], ['assistant', 'Vou cadastrar.']]);
    expect(result.current.pendingActions).toEqual([acao]);
    expect(result.current.activeConversation).toBe(CONV);
    await waitFor(() => expect(m.listarConversasIaApi).toHaveBeenCalled());
    expect(getSession).not.toHaveBeenCalled();
  });

  it('done com o rodapé grava consultas e duração na resposta; intent do onboarding vai no corpo e no tentar de novo', async () => {
    m.abrirAssistenteApi.mockResolvedValueOnce(sse(
      { type: 'text', content: 'Você tem 3 clientes.' },
      { type: 'done', conversation_id: CONV, trace_id: 't', prompt_version: 'v', consultas: 2, duracao_ms: 4200 },
    ));
    const { result } = renderHook(() => useAIChat());
    await act(() => result.current.sendMessage('Quantos clientes?', 'Persona: corretor.', { intent: 'onboarding.help' }));
    expect(m.abrirAssistenteApi.mock.calls[0][0]).toMatchObject({ intent: 'onboarding.help', file_context: 'Persona: corretor.' });
    expect(result.current.messages[1].metadata).toEqual({ consultas: 2, duracao_ms: 4200 });
    m.abrirAssistenteApi.mockResolvedValueOnce(sse({ type: 'error', error: 'Erro ao comunicar com IA' }));
    await act(() => result.current.retry());
    expect(m.abrirAssistenteApi.mock.calls[1][0]).toMatchObject({ intent: 'onboarding.help', message: 'Quantos clientes?' });
    // erro no stream sem texto: a bolha vazia da resposta sai da tela
    expect(result.current.messages.map((x) => [x.role, x.content])).toEqual([
      ['user', 'Quantos clientes?'], ['assistant', 'Você tem 3 clientes.'], ['user', 'Quantos clientes?'],
    ]);
    expect(result.current.error).toBe('Erro ao comunicar com IA');
  });

  it('trocar de conversa no meio do stream encerra o envio: nada cai na conversa nova', async () => {
    m.abrirAssistenteApi.mockImplementationOnce((_corpo, sinal) => new Promise<Response>((_ok, falha) => {
      sinal?.addEventListener('abort', () => falha(new DOMException('abortado', 'AbortError')));
    }));
    m.listarMensagensIaApi.mockResolvedValueOnce([{ id: 'x', role: 'user', content: 'outra conversa' }]);
    const { result } = renderHook(() => useAIChat());
    let envio: Promise<void> = Promise.resolve();
    act(() => { envio = result.current.sendMessage('pergunta'); });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    await act(() => result.current.loadConversation(OUTRA));
    await act(() => envio);
    expect(result.current.activeConversation).toBe(OUTRA);
    expect(result.current.messages.map((x) => x.content)).toEqual(['outra conversa']);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('apagar a conversa aberta no meio do stream encerra o envio', async () => {
    m.listarMensagensIaApi.mockResolvedValueOnce([]);
    m.apagarConversaIaApi.mockResolvedValueOnce(undefined);
    let sinalVisto: AbortSignal | undefined;
    m.abrirAssistenteApi.mockImplementationOnce((_corpo, sinal) => new Promise<Response>((_ok, falha) => {
      sinalVisto = sinal;
      sinal?.addEventListener('abort', () => falha(new DOMException('abortado', 'AbortError')));
    }));
    const { result } = renderHook(() => useAIChat());
    await act(() => result.current.loadConversation(CONV));
    let envio: Promise<void> = Promise.resolve();
    act(() => { envio = result.current.sendMessage('pergunta'); });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    await act(() => result.current.deleteConversation(CONV));
    await act(() => envio);
    expect(sinalVisto?.aborted).toBe(true);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages).toEqual([]);
  });

  it('turno que termina sem texto e sem ação vira erro com tentar de novo, sem bolha vazia', async () => {
    m.abrirAssistenteApi.mockResolvedValueOnce(sse({ type: 'done', conversation_id: CONV, trace_id: 't', prompt_version: 'v', consultas: 3, duracao_ms: 900 }));
    const { result } = renderHook(() => useAIChat());
    await act(() => result.current.sendMessage('Como está o funil?'));
    expect(result.current.error).toBe('O assistente não trouxe resposta. Tente novamente.');
    expect(result.current.messages.map((x) => x.role)).toEqual(['user']);
  });

  it('erro antes do stream (cota) aparece com o texto da API e some a bolha vazia', async () => {
    m.abrirAssistenteApi.mockRejectedValueOnce(new ErroApi(402, 'PLAN_LIMIT_REACHED', 'Seu plano atual não inclui o Assistente Lotti.'));
    const { result } = renderHook(() => useAIChat());
    await act(() => result.current.sendMessage('oi'));
    expect(result.current.error).toBe('Seu plano atual não inclui o Assistente Lotti.');
    expect(result.current.messages.map((x) => x.role)).toEqual(['user']);
    expect(result.current.isStreaming).toBe(false);
  });

  it('confirmar e recusar ação pela API', async () => {
    m.decidirAcaoIaApi.mockResolvedValueOnce({ status: 'executed', proposal_id: OUTRA, record_id: 'c1', existing: true });
    m.abrirAssistenteApi.mockResolvedValueOnce(sse({ type: 'action', action: acao }, { type: 'action', action: { ...acao, id: CONV } }));
    const { result } = renderHook(() => useAIChat());
    await act(() => result.current.sendMessage('x'));
    await act(() => result.current.confirmAction(acao));
    expect(m.decidirAcaoIaApi).toHaveBeenCalledWith(OUTRA, 'confirm');
    expect(toast.success).toHaveBeenCalledWith('Este cliente já estava cadastrado. Nenhum cadastro novo foi criado.');
    m.decidirAcaoIaApi.mockResolvedValueOnce({ status: 'rejected', proposal_id: CONV });
    await act(() => result.current.rejectAction(CONV));
    expect(m.decidirAcaoIaApi).toHaveBeenLastCalledWith(CONV, 'reject');
    expect(result.current.pendingActions.map((a) => a.status)).toEqual(['confirmed', 'rejected']);

    m.decidirAcaoIaApi.mockRejectedValueOnce(new ErroApi(500, 'acao_nao_executada', 'Não foi possível executar a ação.'));
    await act(() => result.current.confirmAction(acao));
    expect(toast.error).toHaveBeenCalledWith('Não foi possível executar a ação.');
    // O servidor marcou como falha: o cartão sai de "pendente" (o Expandir do widget não fica travado).
    expect(result.current.pendingActions.map((a) => a.status)).toEqual(['failed', 'rejected']);
  });

  it('fixar com falha recarrega a lista; apagar avisa; abrir conversa mostra só usuário e assistente', async () => {
    m.alterarConversaIaApi.mockRejectedValueOnce(new Error('x'));
    m.apagarConversaIaApi.mockResolvedValueOnce(undefined);
    m.listarMensagensIaApi.mockResolvedValueOnce([
      { id: 'a', role: 'user', content: 'oi' },
      // rodada de consulta: gravada sem texto, não vira bolha vazia
      { id: 'd', role: 'assistant', content: '', tool_calls: [{ id: 'call_1' }] },
      { id: 'b', role: 'tool', content: '{}' },
      { id: 'c', role: 'assistant', content: 'olá' },
    ]);
    const { result } = renderHook(() => useAIChat());
    await act(() => result.current.loadConversations());
    await act(() => result.current.togglePin(OUTRA, true));
    expect(m.alterarConversaIaApi).toHaveBeenCalledWith(OUTRA, { pinned: true });
    expect(toast.error).toHaveBeenCalledWith('Não foi possível fixar a conversa.');
    expect(m.listarConversasIaApi).toHaveBeenCalledTimes(2);
    await act(() => result.current.deleteConversation(OUTRA));
    expect(m.apagarConversaIaApi).toHaveBeenCalledWith(OUTRA);
    expect(toast.success).toHaveBeenCalledWith('Conversa excluída.');
    await act(() => result.current.loadConversation(CONV));
    expect(result.current.messages.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('anexo pela API devolve o texto extraído; erro vira mensagem', async () => {
    m.enviarAnexoIaApi.mockResolvedValueOnce({ storage_path: 'u/1.txt', extracted_text: 'conteúdo', metadata: {}, file_name: 'a.txt', file_type: 'text/plain', file_size: 8 });
    const { result } = renderHook(() => useAIChat());
    const file = new File(['conteúdo'], 'a.txt', { type: 'text/plain' });
    let r: Awaited<ReturnType<typeof result.current.uploadFile>> = null;
    await act(async () => { r = await result.current.uploadFile(file); });
    expect(r).toMatchObject({ extracted_text: 'conteúdo', file_name: 'a.txt' });
    m.enviarAnexoIaApi.mockRejectedValueOnce(new ErroApi(400, 'tipo_nao_permitido', 'Tipo de arquivo não permitido.'));
    await act(async () => { r = await result.current.uploadFile(file); });
    expect(r).toBeNull();
    expect(result.current.error).toBe('Tipo de arquivo não permitido.');
  });
});
