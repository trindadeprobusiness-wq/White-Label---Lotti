// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Modo API (bloco B1): a venda e o evento de conversão vão pela API. O Supabase vira um
// objeto vazio: o insert antigo em webhook_logs (que sempre falhava) quebraria o teste.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true }));
const imoveisApi = vi.hoisted(() => ({
  registrarVendaImovelApi: vi.fn(async () => ({ imovel_id: 'i1', status_venda: 'VENDIDO', cliente_atualizado: true })),
  registrarEventoVendaApi: vi.fn(async () => ({ enfileirado: true, id: 'e1' })),
}));
vi.mock('@/lib/api/imoveis', () => imoveisApi);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
const fetchImoveis = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/stores/crmStore', () => ({ useCRMStore: () => ({ clientes: [], fetchImoveis }) }));

import { VendaImovelDialog } from './VendaImovelDialog';

const IMOVEL = { id: 'i1', titulo: 'Casa', valor: 450000, corretor_id: 'c1' };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function confirmar() {
  render(<VendaImovelDialog open onOpenChange={() => undefined} imovel={IMOVEL} />);
  fireEvent.change(screen.getByPlaceholderText('Ex: 500000'), { target: { value: '510000' } });
  fireEvent.click(screen.getByRole('button', { name: /Confirmar Venda/ }));
}

describe('VendaImovelDialog com a API', () => {
  it('registra a venda e enfileira o evento de conversão no servidor', async () => {
    confirmar();
    await waitFor(() => expect(imoveisApi.registrarEventoVendaApi).toHaveBeenCalledWith('i1', { valor: 510000, cliente_id: null }));
    expect(imoveisApi.registrarVendaImovelApi).toHaveBeenCalledWith('i1', null);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: 'Venda registrada com sucesso!', description: 'O evento de conversão foi enfileirado no sistema.',
    }));
  });

  it('evento que falha não desfaz a venda, mas o aviso não diz que foi enfileirado', async () => {
    imoveisApi.registrarEventoVendaApi.mockRejectedValueOnce(new Error('offline'));
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    confirmar();
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: 'Venda registrada com sucesso!', description: 'Mas o evento de conversão não pôde ser enfileirado.',
    }));
    expect(fetchImoveis).toHaveBeenCalled();
    erro.mockRestore();
  });
});
