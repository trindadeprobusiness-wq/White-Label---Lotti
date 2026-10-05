// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke }, auth: { getSession: vi.fn() } } }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn() }));
vi.mock('@/lib/api/contratos', () => ({ analisarContratoIaApi: vi.fn() }));

import { analisarContratoIaApi } from '@/lib/api/contratos';
import { ErroApi } from '@/lib/api/http';
import { analisarContratoCentral, extractContractData } from './contractExtractionService';

const analisar = vi.mocked(analisarContratoIaApi);
const foto = () => new File(['abc'], 'c.png', { type: 'image/png' });
const FALLBACK = /requer a Edge Function/;

beforeEach(() => vi.clearAllMocks());

describe('contractExtractionService com a API Lotti', () => {
  it('sucesso: manda base64 e mimeType e sanitiza os dados', async () => {
    analisar.mockResolvedValue({ valor_aluguel: 'R$ 1.500,00', dia_vencimento: 10 });
    const r = await extractContractData(foto());
    expect(analisar).toHaveBeenCalledWith({ fileBase64: expect.any(String), mimeType: 'image/png' });
    expect(r.dia_vencimento).toBe(10);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([503, 404, 413])('%i cai no fallback do navegador', async (status) => {
    analisar.mockRejectedValue(new ErroApi(status, null, 'x'));
    await expect(extractContractData(foto())).rejects.toThrow(FALLBACK);
  });

  it('rede fora (TypeError) cai no fallback', async () => {
    analisar.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(extractContractData(foto())).rejects.toThrow(FALLBACK);
  });

  it('400 vira erro com a mensagem da API, sem fallback', async () => {
    analisar.mockRejectedValue(new ErroApi(400, null, 'Formato inválido. Envie PDF ou imagem (JPG, PNG, WEBP).'));
    await expect(extractContractData(foto())).rejects.toThrow('Formato inválido. Envie PDF ou imagem (JPG, PNG, WEBP).');
  });

  it('modo central manda modo e não tem fallback', async () => {
    analisar.mockResolvedValueOnce({ tipo: 'COMPRA_VENDA' });
    expect(await analisarContratoCentral(foto())).toEqual({ tipo: 'COMPRA_VENDA' });
    expect(analisar).toHaveBeenCalledWith({ fileBase64: expect.any(String), mimeType: 'image/png', modo: 'central' });
    analisar.mockRejectedValueOnce(new ErroApi(503, 'ia_indisponivel', 'A IA de contratos está indisponível no momento.'));
    await expect(analisarContratoCentral(foto())).rejects.toThrow('A IA de contratos está indisponível no momento.');
  });
});
