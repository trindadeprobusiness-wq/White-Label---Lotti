// @vitest-environment jsdom
// Fallback do PDF (texto no navegador + Assistente) no modo API: o stream vem de /api/ia/assistente.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() }, auth: { getSession } } }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn(), obterTokenApi: vi.fn() }));
vi.mock('@/lib/api/contratos', () => ({ analisarContratoIaApi: vi.fn() }));
vi.mock('@/lib/api/ia', () => ({ abrirAssistenteApi: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'CONTRATO DE LOCAÇÃO RESIDENCIAL '.repeat(6) }] }) }),
    }),
  }),
}));

import { analisarContratoIaApi } from '@/lib/api/contratos';
import { abrirAssistenteApi } from '@/lib/api/ia';
import { extractContractData } from './contractExtractionService';

const pdf = () => new File(['%PDF-1.4'], 'c.pdf', { type: 'application/pdf' });
const sse = (...eventos: unknown[]) => new Response(eventos.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(analisarContratoIaApi).mockRejectedValue(new TypeError('Failed to fetch'));
});

describe('fallback do contrato pelo Assistente da API', () => {
  it('manda o texto do PDF como file_context e lê o JSON do stream', async () => {
    vi.mocked(abrirAssistenteApi).mockResolvedValueOnce(sse(
      { type: 'text', content: '{"valor_aluguel": 1500, ' },
      { type: 'text', content: '"dia_vencimento": 10}' },
      { type: 'done', conversation_id: 'c', trace_id: 't', prompt_version: 'v' },
    ));
    const r = await extractContractData(pdf());
    expect(r.valor_aluguel).toBe(1500);
    expect(r.dia_vencimento).toBe(10);
    const [corpo] = vi.mocked(abrirAssistenteApi).mock.calls[0];
    expect(corpo.message).toMatch(/^Extraia os dados do contrato de locação/);
    expect(String(corpo.file_context)).toMatch(/^Contrato de locação \(texto extraído do PDF\):\n\nCONTRATO DE LOCAÇÃO/);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('erro antes do stream ou evento de erro viram mensagens para o usuário', async () => {
    vi.mocked(abrirAssistenteApi).mockRejectedValueOnce(new Error('402'));
    await expect(extractContractData(pdf())).rejects.toThrow('O assistente IA não respondeu. Tente novamente.');
    vi.mocked(abrirAssistenteApi).mockResolvedValueOnce(sse({ type: 'error', error: 'Erro ao comunicar com IA' }));
    await expect(extractContractData(pdf())).rejects.toThrow('Erro ao comunicar com IA');
  });
});
