// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ api: true }));
const sb = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn(), invoke: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...a: unknown[]) => { sb.from(...a); return { insert: (...b: unknown[]) => sb.insert(...b) }; },
    functions: { invoke: (...a: unknown[]) => sb.invoke(...a) },
  },
}));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => estado.api, chamarApi: vi.fn() }));
vi.mock('@/lib/api/fachadas', () => ({
  obterFachadaPublicaApi: vi.fn(), registrarEscaneamentoApi: vi.fn(), enviarLeadPublicoApi: vi.fn(),
}));

import * as fachadasApi from '@/lib/api/fachadas';
import { useFachadaPublica } from './useFachadaPublica';

const api = vi.mocked(fachadasApi);
const FACHADA = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  estado.api = true;
  sb.insert.mockResolvedValue({ error: null });
  sb.invoke.mockResolvedValue({ data: { fachada: { id: FACHADA }, fotos: [] }, error: null });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useFachadaPublica com a API ligada', () => {
  it('fetchFachadaPublica usa P1 e não a Edge Function', async () => {
    api.obterFachadaPublicaApi.mockResolvedValue({
      fachada: { id: FACHADA, imovel: null, corretor: { nome: 'Ana' } },
      fotos: [{ id: 'f1', arquivo_url: 'u', principal: true }],
    });
    const { result } = renderHook(() => useFachadaPublica());
    await act(async () => { await result.current.fetchFachadaPublica(FACHADA); });
    expect(api.obterFachadaPublicaApi).toHaveBeenCalledWith(FACHADA);
    expect(sb.invoke).not.toHaveBeenCalled();
    expect(result.current.fachada).toMatchObject({ id: FACHADA, corretor: { nome: 'Ana' } });
    expect(result.current.fachada?.imovel).toBeUndefined();
    expect(result.current.fotos).toEqual([{ id: 'f1', arquivo_url: 'u', principal: true }]);
    expect(result.current.loading).toBe(false);
  });

  it('P1 com erro deixa a fachada null sem lançar', async () => {
    api.obterFachadaPublicaApi.mockRejectedValue(new Error('Esta placa não está mais disponível.'));
    const { result } = renderHook(() => useFachadaPublica());
    await act(async () => { await result.current.fetchFachadaPublica(FACHADA); });
    expect(result.current.fachada).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('registrarEscaneamento usa P2, sem navigator.userAgent no corpo', async () => {
    api.registrarEscaneamentoApi.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFachadaPublica());
    await act(async () => { await result.current.registrarEscaneamento(FACHADA); });
    expect(api.registrarEscaneamentoApi).toHaveBeenCalledWith(FACHADA);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('registrarEscaneamento falha em silêncio: nada lança e o estado não muda', async () => {
    api.registrarEscaneamentoApi.mockRejectedValue(new Error('Muitas tentativas. Aguarde alguns minutos.'));
    const { result } = renderHook(() => useFachadaPublica());
    await act(async () => {
      await expect(result.current.registrarEscaneamento(FACHADA)).resolves.toBeUndefined();
    });
    expect(result.current.fachada).toBeNull();
    expect(result.current.leadCapturado).toBe(false);
  });

  it('enviarLead usa P3, seta leadCapturado e não manda email vazio', async () => {
    api.enviarLeadPublicoApi.mockResolvedValue({ registrado: true });
    const { result } = renderHook(() => useFachadaPublica());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.enviarLead(FACHADA, { nome: 'Ana', telefone: '(11) 99999-8888', email: '' });
    });
    expect(ok).toBe(true);
    expect(api.enviarLeadPublicoApi).toHaveBeenCalledWith(FACHADA, {
      nome: 'Ana', telefone: '(11) 99999-8888', email: undefined,
    });
    expect(result.current.leadCapturado).toBe(true);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('enviarLead devolve false no erro e não seta leadCapturado', async () => {
    api.enviarLeadPublicoApi.mockRejectedValue(new Error('Informe um telefone válido com DDD.'));
    const { result } = renderHook(() => useFachadaPublica());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.enviarLead(FACHADA, { nome: 'Ana', telefone: 'abc' });
    });
    expect(ok).toBe(false);
    expect(result.current.leadCapturado).toBe(false);
  });
});

describe('useFachadaPublica sem VITE_API_URL: igual a hoje', () => {
  beforeEach(() => { estado.api = false; });

  it('volta para a Edge Function e os inserts como anon, sem chamar a API', async () => {
    const { result } = renderHook(() => useFachadaPublica());
    await act(async () => { await result.current.fetchFachadaPublica(FACHADA); });
    expect(sb.invoke).toHaveBeenCalledWith('fachada-publica', { body: { fachadaId: FACHADA } });

    await act(async () => { await result.current.registrarEscaneamento(FACHADA); });
    expect(sb.from).toHaveBeenCalledWith('fachada_escaneamentos');
    expect(sb.insert).toHaveBeenCalledWith(expect.objectContaining({ fachada_id: FACHADA }));

    await act(async () => { await result.current.enviarLead(FACHADA, { nome: 'Ana', telefone: '11999998888' }); });
    expect(sb.from).toHaveBeenCalledWith('fachada_leads');

    expect(api.obterFachadaPublicaApi).not.toHaveBeenCalled();
    expect(api.registrarEscaneamentoApi).not.toHaveBeenCalled();
    expect(api.enviarLeadPublicoApi).not.toHaveBeenCalled();
  });
});
