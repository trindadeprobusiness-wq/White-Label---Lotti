// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContasAtendimento } from './ContasAtendimento';
import { useAtendimento, useOpcoesParceiros } from '@/hooks/admin/useAtendimento';

vi.mock('@/hooks/admin/useAtendimento', () => ({ useAtendimento: vi.fn(), useOpcoesParceiros: vi.fn() }));
const comum = { status: 'ativo', parceiro_id: null, receita_confirmada: 0, ultimo_acesso_em: null };
describe('atendimento de qualquer idade de conta', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(useAtendimento).mockReturnValue({ data: { total: 2, itens: [
      { ...comum, corretor_id: 'antigo', nome: 'Conta antiga', email: 'antigo@exemplo.test', criado_em: '2000-01-01' },
      { ...comum, corretor_id: 'novo', nome: 'Conta nova', email: 'novo@exemplo.test', criado_em: '2026-10-04' },
    ] }, isLoading: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useAtendimento>);
    vi.mocked(useOpcoesParceiros).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useOpcoesParceiros>);
  });
  it('oferece painel real em aba separada tanto para novo como antigo', () => {
    render(<MemoryRouter><ContasAtendimento /></MemoryRouter>);
    expect(screen.getByText('Conta antiga')).toBeTruthy();
    expect(screen.getByText('Conta nova')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Visualizar painel' });
    expect(links.map(l => l.getAttribute('href'))).toEqual(['/suporte/antigo', '/suporte/novo']);
    expect(links.every(l => l.getAttribute('target') === '_blank' && l.getAttribute('rel')?.includes('noopener'))).toBe(true);
  });
  it('busca qualquer conta sem enviar limite de idade ou etapa de onboarding', () => {
    render(<MemoryRouter><ContasAtendimento /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'antigo' } });
    expect(vi.mocked(useAtendimento).mock.lastCall?.[0]).toEqual({ busca: 'antigo', status: 'ativo', origem: 'todos', campanha: '', pagina: 1 });
  });
});
