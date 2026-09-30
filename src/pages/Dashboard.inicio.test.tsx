/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A tela inicial puxa hero, onboarding, notificações e privacidade. Nada disso
// muda o que está em teste — quais blocos sobraram e o que cada lista mostra.
let leadsQr: Record<string, unknown>[] = [];

const estado = {
  clientes: [] as Record<string, unknown>[],
  imoveis: [] as Record<string, unknown>[],
  alertas: [],
  corretor: { nome: 'Rafael' },
  loading: false,
  fetchCorretor: vi.fn(),
  marcarAlertaLido: vi.fn(),
};

vi.mock('@/stores/crmStore', () => ({ useCRMStore: () => estado }));
vi.mock('@/hooks/useFachadas', () => ({
  useFachadas: () => ({ leads: leadsQr, fetchLeads: vi.fn() }),
}));
vi.mock('@/stores/privacidadeStore', () => ({
  usePrivacidade: (seletor: (s: { valoresOcultos: boolean }) => unknown) =>
    seletor({ valoresOcultos: false }),
}));
vi.mock('@/components/dashboard/DashboardHero', () => ({
  DashboardHero: ({ ferramentas }: { ferramentas?: React.ReactNode }) => <div>{ferramentas}</div>,
}));
vi.mock('@/components/onboarding/OnboardingChecklist', () => ({ OnboardingChecklist: () => null }));
vi.mock('@/components/shell/PainelNotificacoes', () => ({ PainelNotificacoes: () => null }));
vi.mock('@/components/shell/PainelAjuda', () => ({ PainelAjuda: () => null }));
vi.mock('@/components/shell/BotaoPrivacidade', () => ({ BotaoPrivacidade: () => null }));
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

describe('Tela inicial — só o que pede ação', () => {
  afterEach(() => {
    cleanup();
    estado.clientes = [];
    estado.imoveis = [];
    leadsQr = [];
  });

  it('não exibe a busca global nem o funil, que repetiam dado já mostrado', () => {
    abrir();

    expect(screen.queryByLabelText('busca-global-renderizada')).toBeNull();
    expect(screen.queryByText('Funil de vendas')).toBeNull();
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
    expect(screen.getByText('Novo pelo QR')).toBeTruthy();
    // Lead já convertido não volta para a fila.
    expect(screen.queryByText('Já virou cliente')).toBeNull();
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
