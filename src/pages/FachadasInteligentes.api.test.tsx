// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DadosNovoTemplate } from '@/components/fachadas/AssistenteTemplateDialog';

const estado = vi.hoisted(() => ({ api: true }));
const sb = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), insert: vi.fn(), delete_: vi.fn() }));
const upload = vi.hoisted(() => vi.fn());
/** O assistente só expõe o callback: é por ele que o teste dispara o salvar. */
const assistente = vi.hoisted(() => ({ onSalvar: null as null | ((d: DadosNovoTemplate) => Promise<void>) }));

function consulta(resultado: unknown): unknown {
  const alvo = {
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve(resultado).then(ok, erro),
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => consulta(resultado)) });
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (tabela: string) => {
      sb.from(tabela);
      return {
        select: () => consulta({ data: [], error: null }),
        insert: (...a: unknown[]) => { sb.insert(...a); return consulta({ data: { id: 'tpl-1', created_at: null }, error: null }); },
        delete: (...a: unknown[]) => { sb.delete_(...a); return consulta({ data: null, error: null }); },
      };
    },
    rpc: (...a: unknown[]) => { sb.rpc(...a); return Promise.resolve({ data: 'corretor-1', error: null }); },
  },
}));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => estado.api, chamarApi: vi.fn() }));
vi.mock('@/lib/api/fachadas', () => ({
  listarTemplatesApi: vi.fn(), criarTemplateApi: vi.fn(), excluirTemplateApi: vi.fn(),
}));
vi.mock('@/hooks/useFileUpload', () => ({ useFileUpload: () => ({ upload, uploading: false }) }));
// O objeto tem de ser ESTÁVEL entre renders: os useEffect da tela dependem de
// fetchFachadas/fetchMetricas/fetchLeads e um objeto novo a cada render faria
// a tela entrar em laço infinito de renderização.
const hook = vi.hoisted(() => ({
  fachadas: [] as unknown[], leads: [] as unknown[], leadsLoading: false,
  metricas: null, loading: false,
  fetchFachadas: vi.fn(), createFachada: vi.fn(), updateFachada: vi.fn(),
  deleteFachada: vi.fn(), fetchLeads: vi.fn(), fetchMetricas: vi.fn(), deleteLead: vi.fn(),
}));
vi.mock('@/hooks/useFachadas', () => ({ useFachadas: () => hook }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/shell/PageHeader', () => ({ PageHeader: () => null }));
vi.mock('@/components/subscription/LimitGuard', () => ({
  LimitGuard: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/fachadas/FachadaCard', () => ({ FachadaCard: () => null }));
vi.mock('@/components/fachadas/FachadaPreview', () => ({ FachadaPreview: () => null }));
vi.mock('@/components/fachadas/CriarFachadaDialog', () => ({ CriarFachadaDialog: () => null }));
vi.mock('@/components/fachadas/FachadaDashboard', () => ({ FachadaDashboard: () => null }));
vi.mock('@/components/fachadas/LeadsTable', () => ({ LeadsTable: () => null }));
vi.mock('@/components/fachadas/AssistenteTemplateDialog', () => ({
  AssistenteTemplateDialog: (p: { onSalvar: (d: DadosNovoTemplate) => Promise<void> }) => {
    assistente.onSalvar = p.onSalvar;
    return null;
  },
}));

import * as fachadasApi from '@/lib/api/fachadas';
import FachadasInteligentes from './FachadasInteligentes';

const api = vi.mocked(fachadasApi);

const dadosTemplate: DadosNovoTemplate = {
  nome: 'Arte nova',
  arquivo: new File(['x'], 'arte.png', { type: 'image/png' }),
  qrPosition: { x: 10, y: 20 },
  qrSize: 25,
};

beforeEach(() => {
  vi.clearAllMocks();
  estado.api = true;
  assistente.onSalvar = null;
  upload.mockResolvedValue({ url: 'https://storage/arte.png' });
  api.listarTemplatesApi.mockResolvedValue([]);
  api.criarTemplateApi.mockResolvedValue({ id: 'tpl-api', created_at: '2026-10-05T00:00:00+00:00' });
});

describe('FachadasInteligentes — templates personalizados', () => {
  it('com a API, a lista usa F8 escopo=meus e o get_corretor_id da consulta some', async () => {
    api.listarTemplatesApi.mockResolvedValue([
      { id: 'tpl-api', nome: 'Arte', created_at: 'x', config: { imagem_url: 'https://s/a.png', qrSize: 30 } },
    ]);
    render(<FachadasInteligentes />);
    await waitFor(() => expect(api.listarTemplatesApi).toHaveBeenCalledWith('meus'));
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(sb.from).not.toHaveBeenCalledWith('fachada_templates');
  });

  it('com a API, o upload e o get_corretor_id do caminho do Storage CONTINUAM; só o insert troca', async () => {
    render(<FachadasInteligentes />);
    await waitFor(() => expect(assistente.onSalvar).toBeTypeOf('function'));
    await act(async () => { await assistente.onSalvar!(dadosTemplate); });

    // O caminho do Storage é escopado por fachadas/<corretor_id>/ e segue precisando do rpc.
    expect(sb.rpc).toHaveBeenCalledWith('get_corretor_id');
    expect(upload).toHaveBeenCalledTimes(1);
    expect((upload.mock.calls[0][1] as string)).toMatch(/^fachadas\/corretor-1\//);

    expect(api.criarTemplateApi).toHaveBeenCalledWith(expect.objectContaining({
      nome: 'Arte nova', categoria: 'VENDA', padrao: false,
      config: expect.objectContaining({
        imagem_url: 'https://storage/arte.png', qrPosition: { x: 10, y: 20 }, qrSize: 25,
      }),
    }));
    // Nenhum corretor_id vai no corpo: o DTO não o aceita.
    expect(api.criarTemplateApi.mock.calls[0][0]).not.toHaveProperty('corretor_id');
    expect(sb.insert).not.toHaveBeenCalled();
  });

  it('com a API, o erro do F9 NÃO é engolido', async () => {
    api.criarTemplateApi.mockRejectedValue(new Error('Não foi possível salvar o template.'));
    render(<FachadasInteligentes />);
    await waitFor(() => expect(assistente.onSalvar).toBeTypeOf('function'));
    await act(async () => { await assistente.onSalvar!(dadosTemplate); });
    const { toast } = await import('@/hooks/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive', description: 'Não foi possível salvar o template.',
    }));
  });

  it('sem VITE_API_URL, lista, insert e delete voltam ao Supabase e a API não é chamada', async () => {
    estado.api = false;
    render(<FachadasInteligentes />);
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('get_corretor_id'));
    expect(sb.from).toHaveBeenCalledWith('fachada_templates');

    await waitFor(() => expect(assistente.onSalvar).toBeTypeOf('function'));
    await act(async () => { await assistente.onSalvar!(dadosTemplate); });
    expect(sb.insert).toHaveBeenCalledWith(expect.objectContaining({ corretor_id: 'corretor-1', nome: 'Arte nova' }));

    expect(api.listarTemplatesApi).not.toHaveBeenCalled();
    expect(api.criarTemplateApi).not.toHaveBeenCalled();
    expect(api.excluirTemplateApi).not.toHaveBeenCalled();
  });
});
