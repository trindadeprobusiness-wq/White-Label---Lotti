/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A tela inicial puxa hero, onboarding, notificações e privacidade. Nada disso
// muda o que está em teste — quais blocos sobraram e o que cada lista mostra.
let leadsQr: Record<string, unknown>[] = [];
let fachadasQr: Record<string, unknown>[] = [];
let espera: { esperando: number; urgentes: number } | undefined;

const estado = {
  clientes: [] as Record<string, unknown>[],
  imoveis: [] as Record<string, unknown>[],
  contratos: [] as Record<string, unknown>[],
  alertas: [],
  corretor: { nome: 'Rafael' },
  loading: false,
  fetchCorretor: vi.fn(),
  marcarAlertaLido: vi.fn(),
};

vi.mock('@/stores/crmStore', () => ({ useCRMStore: () => estado }));
vi.mock('@/hooks/useFachadas', () => ({
  useFachadas: () => ({ leads: leadsQr, fachadas: fachadasQr, fetchLeads: vi.fn(), fetchFachadas: vi.fn() }),
}));
// O card de qualificação conta pelo Funil de Vendas (etapas e oportunidades), não pelo status_funil do cadastro.
const funil = vi.hoisted(() => ({
  etapas: [1, 2, 3, 4].map((ordem) => ({ id: 'e' + ordem, ordem, tipo: 'ABERTA' })),
  oportunidades: [{ etapa_id: 'e3', fechada_em: null }, { etapa_id: 'e3', fechada_em: null }, { etapa_id: 'e2', fechada_em: null }],
}));
vi.mock('@/hooks/crm/useCrm', () => ({
  useEtapas: () => ({ data: funil.etapas }),
  useOportunidades: () => ({ data: funil.oportunidades }),
}));
vi.mock('@/hooks/useConversasEsperando', () => ({
  useConversasEsperando: () => ({ data: espera }),
}));
vi.mock('@/stores/privacidadeStore', () => ({
  usePrivacidade: (seletor: (s: { valoresOcultos: boolean }) => unknown) =>
    seletor({ valoresOcultos: false }),
}));
vi.mock('@/components/onboarding/OnboardingChecklist', () => ({ OnboardingChecklist: () => null }));
vi.mock('@/components/shell/GlobalSearch', () => ({
  GlobalSearch: () => <input aria-label="busca-global-renderizada" />,
}));

import Dashboard from './Dashboard';

const emDias = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString();
};

const abrir = () => render(<MemoryRouter><Dashboard /></MemoryRouter>);

it('junta alertas repetidos numa linha só, com a contagem', () => {
  // Quatro contatos esbarrando no mesmo plano viravam quatro linhas idênticas,
  // e a tela parecia quatro problemas distintos.
  estado.alertas = Array.from({ length: 4 }, (_, i) => ({
    id: `a${i}`, mensagem: 'Novo contato aguardando atendimento: plano de IA indisponível',
    lido: false, prioridade: 'ALTA', cliente_id: `cliente-${i}`, created_at: '2026-10-01T12:00:00Z',
  })) as never;
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  expect(screen.getAllByText(/plano de IA indispon/)).toHaveLength(1);
  expect(screen.getByText(/Ações críticas \(4\)/)).not.toBeNull();
  estado.alertas = [] as never;
});

describe('Tela inicial — só o que pede ação', () => {
  afterEach(() => {
    cleanup();
    estado.clientes = [];
    estado.imoveis = [];
    leadsQr = [];
    fachadasQr = [];
    espera = undefined;
    estado.contratos = [];
  });

  it('não exibe a busca global nem o funil, que repetiam dado já mostrado', () => {
    abrir();

    expect(screen.queryByLabelText('busca-global-renderizada')).toBeNull();
    expect(screen.queryByText('Funil de vendas')).toBeNull();
  });

  it('abre com um cabeçalho que diz o dia, no lugar da antiga fila de ícones', () => {
    abrir();

    expect(screen.getByText('Hoje')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Rafael');
    expect(screen.getByText(/o que precisa de você agora/)).toBeTruthy();
  });

  it('em "Imóveis que pedem atenção" não entra cadastro completo', () => {
    estado.imoveis = [
      { id: 'a', titulo: 'Sem preço', valor: 0, endereco: '', cidade: 'Anápolis' },
      { id: 'b', titulo: 'Galpão completo', valor: 6900, endereco: 'Rua 1', bairro: 'Centro', cidade: 'Anápolis' },
    ];

    abrir();

    expect(screen.getByText('Sem preço')).toBeTruthy();
    expect(screen.queryByText('Galpão completo')).toBeNull();
    expect(screen.queryByText('Cadastro completo')).toBeNull();
  });

  it('põe o lead que chegou pelo QR na frente do follow-up', () => {
    leadsQr = [
      { id: 'l1', nome: 'Quem escaneou', telefone: '(62) 98888-0000', convertido: false, created_at: new Date().toISOString() },
      { id: 'l2', nome: 'Já virou cliente', telefone: '(62) 98888-0001', convertido: true, created_at: new Date().toISOString() },
    ];
    estado.clientes = [
      { id: 'c1', nome: 'Marlene', telefone: '(62) 99999-9999', status_funil: 'QUALIFICACAO', proximo_followup: emDias(-3) },
    ];

    abrir();

    const nomes = screen.getAllByText(/Quem escaneou|Marlene/).map((n) => n.textContent);
    expect(nomes).toEqual(['Quem escaneou', 'Marlene']);
    expect(screen.getByText('Espera agora')).toBeTruthy();
    // Lead já convertido não volta para a fila.
    expect(screen.queryByText('Já virou cliente')).toBeNull();
  });

  it('mostra as conversas esperando resposta, que não apareciam em lugar nenhum', () => {
    espera = { esperando: 7, urgentes: 3 };

    abrir();

    expect(screen.getByText('Conversas esperando resposta')).toBeTruthy();
    expect(screen.getByText('7 sem resposta · 3 há mais de 1 h')).toBeTruthy();
  });

  it('sem ninguém esperando, a linha não ocupa espaço', () => {
    espera = { esperando: 0, urgentes: 0 };

    abrir();

    expect(screen.queryByText('Conversas esperando resposta')).toBeNull();
  });

  it('diz de qual imóvel o lead veio, não só que veio pelo QR', () => {
    fachadasQr = [{ id: 'f1', imovel: { titulo: 'Galpão Santos Dumont' } }];
    leadsQr = [{
      id: 'l1', nome: 'Quem escaneou', telefone: '(62) 98888-0000', fachada_id: 'f1',
      convertido: false, created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    }];

    abrir();

    expect(screen.getByText(/QR · Galpão Santos Dumont/)).toBeTruthy();
    expect(screen.getByText('Espera há 12 min')).toBeTruthy();
  });

  it('conta contrato perto do fim da vigência, e ignora rascunho', () => {
    const inicio = new Date();
    inicio.setMonth(inicio.getMonth() - 11);
    estado.contratos = [
      { id: 'c1', status: 'FINALIZADO', data_inicio: inicio.toISOString(), prazo_meses: 12 },
      { id: 'c2', status: 'RASCUNHO', data_inicio: inicio.toISOString(), prazo_meses: 12 },
    ];

    abrir();

    expect(screen.getByText('Contratos perto do fim da vigência')).toBeTruthy();
    expect(screen.getByText('1 nos próximos 60 dias')).toBeTruthy();
  });

  it('marca o follow-up atrasado, que era ordenado sem nunca aparecer', () => {
    estado.clientes = [
      { id: 'c1', nome: 'Marlene', telefone: '(62) 99999-9999', status_funil: 'QUALIFICACAO', proximo_followup: emDias(-3) },
      { id: 'c2', nome: 'Hélio', telefone: '(62) 99999-9997', status_funil: 'QUALIFICACAO', proximo_followup: emDias(0) },
    ];

    abrir();

    expect(screen.getByText('Atrasado 3d')).toBeTruthy();
    expect(screen.getByText('Contato hoje')).toBeTruthy();
  });
});

it('"Leads aguardando avanço" conta pelo Funil: só a etapa Em qualificação (3ª), não o cadastro antigo', () => {
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  expect(screen.getByText('2 leads em qualificação no funil')).toBeTruthy();
});
