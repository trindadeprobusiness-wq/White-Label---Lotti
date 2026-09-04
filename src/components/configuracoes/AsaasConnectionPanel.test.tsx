import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AsaasConnectionPanel } from './AsaasConnectionPanel';

const estado = vi.hoisted(() => ({ conexao: null as null | Record<string, unknown> }));

vi.mock('@/hooks/useAsaasConnection', () => ({
  useAsaasConnection: () => ({
    conexao: estado.conexao,
    disponivel: true,
    carregando: false,
    erro: null,
    recarregar: vi.fn(),
    conectar: { mutateAsync: vi.fn(), isPending: false },
    desconectar: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

describe('conexão Asaas por operação', () => {
  beforeEach(() => { estado.conexao = null; });

  it('sem conexão não exibe saldo nem sugere uma conta compartilhada', () => {
    const html = renderToStaticMarkup(<AsaasConnectionPanel />);
    expect(html).toContain('Conectar sua conta Asaas');
    expect(html).toContain('chave exclusiva para a Lotti');
    expect(html).not.toMatch(/R\$\s*[\d.,]+/);
    expect(html).not.toContain('conta principal da Lotti');
  });

  it('mostra somente os últimos caracteres da chave validada', () => {
    estado.conexao = {
      id: 'cx-1',
      ambiente: 'producao',
      status: 'conectada',
      conta_nome: 'Imobiliária Horizonte',
      conta_email: 'financeiro@exemplo.com',
      chave_final: '4821',
      escopos_faltando: [],
      validada_em: '2026-08-31T20:00:00Z',
      webhook_configurado_em: '2026-08-31T20:00:00Z',
      herdada_do_ambiente: false,
      rotacao_pendente: false,
    };
    const html = renderToStaticMarkup(<AsaasConnectionPanel />);
    expect(html).toContain('Imobiliária Horizonte');
    expect(html).toContain('•••• 4821');
    expect(html).toContain('Configurado automaticamente');
    expect(html).not.toContain('$aact_');
  });
});
