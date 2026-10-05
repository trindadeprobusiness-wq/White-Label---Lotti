import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn() }));
vi.mock('@/lib/api/financeiro', () => ({
  acaoAsaasApi: vi.fn(), alterarVencimentoApi: vi.fn(), cancelarFaturaApi: vi.fn(), darBaixaApi: vi.fn(),
  estornarFaturaApi: vi.fn(), garantirFaturaApi: vi.fn(), listarContratosAtivosApi: vi.fn(), listarFaturasApi: vi.fn(),
  reativarFaturaApi: vi.fn(), saldoAsaasApi: vi.fn(),
}));

import * as finApi from '@/lib/api/financeiro';
import { ErroApi } from '@/lib/api/http';
import { garantirFaturaPelaApi, saldoPelaApi } from './BillsList';

const api = vi.mocked(finApi);

beforeEach(() => vi.clearAllMocks());

describe('BillsList com a API', () => {
  it('ensureFatura usa garantirFaturaApi e devolve o id', async () => {
    api.garantirFaturaApi.mockResolvedValue({ id: 'f1', criada: false });
    const bill = { contract: { id: 'c1', valor: 999 }, mesReferencia: '2026-10', dueDate: new Date('2026-10-10T12:00:00Z') };
    await expect(garantirFaturaPelaApi(bill, '2026-09')).resolves.toBe('f1');
    expect(api.garantirFaturaApi).toHaveBeenCalledWith({ contrato_id: 'c1', mes_referencia: '2026-10', data_vencimento: '2026-10-10' });
  });

  it('sem mesReferencia usa o mês da tela', async () => {
    api.garantirFaturaApi.mockResolvedValue({ id: 'f2', criada: true });
    await garantirFaturaPelaApi({ contract: { id: 'c1' }, dueDate: new Date('2026-09-05T12:00:00Z') }, '2026-09');
    expect(api.garantirFaturaApi).toHaveBeenCalledWith({ contrato_id: 'c1', mes_referencia: '2026-09', data_vencimento: '2026-09-05' });
  });

  it('saldo com ASAAS_NAO_CONECTADO vira convite para conectar', async () => {
    api.saldoAsaasApi.mockRejectedValue(new ErroApi(409, 'ASAAS_NAO_CONECTADO', 'Conecte sua conta.'));
    await expect(saldoPelaApi()).resolves.toEqual({ naoConectado: true, saldo: null, nota: null });
  });

  it('saldo indisponível mostra a nota; outro erro mostra a falha', async () => {
    api.saldoAsaasApi.mockResolvedValueOnce({ balance: null, unavailable: true, message: 'Sem permissão de saldo.' });
    await expect(saldoPelaApi()).resolves.toEqual({ naoConectado: false, saldo: null, nota: 'Sem permissão de saldo.' });
    api.saldoAsaasApi.mockResolvedValueOnce({ balance: 1234.5 });
    await expect(saldoPelaApi()).resolves.toEqual({ naoConectado: false, saldo: 1234.5, nota: null });
    api.saldoAsaasApi.mockRejectedValueOnce(new ErroApi(503, 'asaas_nao_configurado', 'x'));
    await expect(saldoPelaApi()).resolves.toEqual({ naoConectado: false, saldo: null, nota: 'Não foi possível carregar o saldo agora.' });
  });
});
