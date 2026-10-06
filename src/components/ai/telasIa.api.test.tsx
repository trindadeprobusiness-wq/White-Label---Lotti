// @vitest-environment jsdom
// Telas de IA no modo API (VITE_API_URL): nenhuma chamada direta ao Supabase.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabase = vi.hoisted(() => ({
  from: vi.fn(() => { throw new Error('supabase.from no modo API'); }),
  rpc: vi.fn(() => { throw new Error('supabase.rpc no modo API'); }),
  functions: { invoke: vi.fn(() => { throw new Error('functions.invoke no modo API'); }) },
  auth: { getSession: vi.fn(() => { throw new Error('getSession no modo API'); }) },
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => 't') }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({ supabase }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn(), obterTokenApi: vi.fn() }));
vi.mock('@/lib/imagem', () => ({ urlParaBase64: vi.fn(async (url: string) => `b64:${url}`) }));
vi.mock('@/lib/api/imoveis', () => ({ obterImovelApi: vi.fn() }));
vi.mock('@/lib/api/ia', () => ({
  listarImoveisSugestaoApi: vi.fn(),
  sugerirRespostaInboxApi: vi.fn(),
  analisarFotosImovelApi: vi.fn(),
  salvarDescricaoImovelApi: vi.fn(),
}));

import * as ia from '@/lib/api/ia';
import * as imoveis from '@/lib/api/imoveis';
import { ReplySuggestion } from '@/features/whatsapp-inbox/ReplySuggestion';
import { OrganizarFotosIA } from '@/components/imoveis/OrganizarFotosIA';

const m = vi.mocked(ia);
const IMOVEL = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('ReplySuggestion com a API', () => {
  it('lista os imóveis pela API (sem get_corretor_id) e gera a sugestão pela rota da API', async () => {
    m.listarImoveisSugestaoApi.mockResolvedValueOnce([{ id: IMOVEL, titulo: 'Casa Centro' }]);
    m.sugerirRespostaInboxApi.mockResolvedValueOnce({ suggestion: 'Sim, tem garagem.', propertyId: IMOVEL, requiresReview: true });
    const onUse = vi.fn();
    render(<ReplySuggestion question="Tem garagem?" onUse={onUse} />);
    fireEvent.click(screen.getByRole('button', { name: /Sugerir resposta/ }));
    await screen.findByRole('option', { name: 'Casa Centro' });
    fireEvent.change(screen.getByLabelText('Imóvel para a sugestão'), { target: { value: IMOVEL } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar sugestão' }));
    expect(await screen.findByDisplayValue('Sim, tem garagem.')).toBeTruthy();
    expect(m.sugerirRespostaInboxApi).toHaveBeenCalledWith({ propertyId: IMOVEL, question: 'Tem garagem?' });
    fireEvent.click(screen.getByRole('button', { name: 'Usar no rascunho' }));
    expect(onUse).toHaveBeenCalledWith('Sim, tem garagem.');
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('erro da API aparece na tela', async () => {
    m.listarImoveisSugestaoApi.mockResolvedValueOnce([{ id: IMOVEL, titulo: 'Casa Centro' }]);
    m.sugerirRespostaInboxApi.mockRejectedValueOnce(new Error('Aguarde um minuto para tentar novamente.'));
    render(<ReplySuggestion question="Oi" onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Sugerir resposta/ }));
    await screen.findByRole('option', { name: 'Casa Centro' });
    fireEvent.change(screen.getByLabelText('Imóvel para a sugestão'), { target: { value: IMOVEL } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar sugestão' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Aguarde um minuto para tentar novamente.');
  });
});

describe('OrganizarFotosIA com a API', () => {
  it('lê o imóvel e analisa pela API, ordena por cômodo e grava a descrição aprovada pela API', async () => {
    vi.mocked(imoveis.obterImovelApi).mockResolvedValueOnce({ id: IMOVEL, titulo: 'Casa', tipo: 'CASA', bairro: 'Centro', cidade: 'Anápolis', descricao: 'Antiga' });
    m.analisarFotosImovelApi.mockResolvedValueOnce({
      fotos: [{ indice: 0, categoria: 'BANHEIRO' }, { indice: 1, categoria: 'FACHADA' }],
      descricao_sugerida: 'Casa clara no Centro.',
    });
    m.salvarDescricaoImovelApi.mockResolvedValueOnce({ id: IMOVEL, descricao: 'Casa clara no Centro.' });
    const onOrdenar = vi.fn();
    const fotos = [
      { id: 'f1', arquivo_url: 'u1', ordem: 0 },
      { id: 'f2', arquivo_url: 'u2', ordem: 1 },
    ] as never;
    render(<OrganizarFotosIA imovelId={IMOVEL} fotos={fotos} onOrdenar={onOrdenar} />);
    fireEvent.click(screen.getByRole('button', { name: /Organizar com IA/ }));
    await waitFor(() => expect(onOrdenar).toHaveBeenCalledWith(['f2', 'f1']));
    expect(m.analisarFotosImovelApi).toHaveBeenCalledWith({
      imagens: ['b64:u1', 'b64:u2'],
      descricao_atual: 'Antiga',
      dados_imovel: { titulo: 'Casa', tipo: 'CASA', bairro: 'Centro', cidade: 'Anápolis' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Usar a sugestão/ }));
    await waitFor(() => expect(m.salvarDescricaoImovelApi).toHaveBeenCalledWith(IMOVEL, 'Casa clara no Centro.'));
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
