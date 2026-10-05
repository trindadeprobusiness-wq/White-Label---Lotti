// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => ({
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
  getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://x/doc.pdf' } })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from, rpc, storage: { from: () => storage } } }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn() }));
vi.mock('@/lib/api/contratos', () => ({
  listarDocumentosApi: vi.fn(),
  criarDocumentoApi: vi.fn(),
  alterarDocumentoApi: vi.fn(),
  removerDocumentoApi: vi.fn(),
}));
vi.mock('@/lib/api/arquivos', () => ({
  enviarArquivoApi: vi.fn(async () => 'key'),
  apagarArquivoApi: vi.fn(async () => undefined),
  baixarPrivadoApi: vi.fn(async () => 'blob:obj'),
}));

import * as api from '@/lib/api/contratos';
import * as arquivos from '@/lib/api/arquivos';
import { useDocumentos } from './useDocumentos';

const m = vi.mocked(api);
const a = vi.mocked(arquivos);
const DOC = '11111111-1111-4111-8111-111111111111';
const CORRETOR = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  m.listarDocumentosApi.mockResolvedValue([{ id: DOC, nome: 'RG', validado: false }]);
});

async function montar() {
  const r = renderHook(() => useDocumentos());
  await waitFor(() => expect(r.result.current.loading).toBe(false));
  return r;
}

describe('useDocumentos com a API Lotti', () => {
  it('lista pela API', async () => {
    const { result } = await montar();
    expect(result.current.documentos).toEqual([{ id: DOC, nome: 'RG', validado: false }]);
    expect(from).not.toHaveBeenCalled();
  });

  it('validar manda só { validado }, sem updated_at', async () => {
    m.alterarDocumentoApi.mockResolvedValue({ id: DOC });
    const { result } = await montar();
    await act(() => result.current.toggleValidacao(DOC, true));
    expect(m.alterarDocumentoApi).toHaveBeenCalledWith(DOC, { validado: true });
    expect(result.current.documentos[0].validado).toBe(true);
  });

  it('editar manda os campos sem updated_at', async () => {
    m.alterarDocumentoApi.mockResolvedValue({ id: DOC });
    const { result } = await montar();
    await act(() => result.current.updateDocumento(DOC, { nome: 'CNH' }));
    expect(m.alterarDocumentoApi).toHaveBeenCalledWith(DOC, { nome: 'CNH' });
  });

  it('upload: arquivo vai pela API (Garage) e o registro é criado sem corretor_id', async () => {
    rpc.mockResolvedValue({ data: CORRETOR, error: null });
    m.criarDocumentoApi.mockResolvedValue({ id: DOC });
    const { result } = await montar();
    const file = new File(['x'], 'rg.pdf', { type: 'application/pdf' });
    await act(async () => { await result.current.uploadDocumento(file, 'RG', 'RG'); });
    // Nada de Storage do Supabase: o upload passa pela API.
    expect(storage.upload).not.toHaveBeenCalled();
    expect(a.enviarArquivoApi).toHaveBeenCalledTimes(1);
    const [grupo, key, enviado] = a.enviarArquivoApi.mock.calls[0];
    expect(grupo).toBe('documento');
    expect(String(key).startsWith(`${CORRETOR}/geral/`)).toBe(true);
    expect(enviado).toBe(file);
    const corpo = m.criarDocumentoApi.mock.calls[0][0] as Record<string, unknown>;
    expect(corpo.arquivo_path).toBe(key);
    // Bucket privado: arquivo_url é a própria key, não uma URL pública.
    expect(corpo.arquivo_url).toBe(key);
    expect(corpo).not.toHaveProperty('corretor_id');
    expect(corpo).not.toHaveProperty('validado');
    expect(from).not.toHaveBeenCalled();
  });

  it('excluir: remove pela API (Garage) e depois o registro pela API', async () => {
    m.removerDocumentoApi.mockResolvedValue(undefined);
    const { result } = await montar();
    await act(() => result.current.deleteDocumento(DOC, `${CORRETOR}/geral/a.pdf`));
    expect(storage.remove).not.toHaveBeenCalled();
    expect(a.apagarArquivoApi).toHaveBeenCalledWith('documento', `${CORRETOR}/geral/a.pdf`);
    expect(m.removerDocumentoApi).toHaveBeenCalledWith(DOC);
  });
});
