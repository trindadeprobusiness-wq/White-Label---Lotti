import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LeadsTable } from './LeadsTable';

vi.mock('@/stores/privacidadeStore', () => ({
  usePrivacidade: () => true,
}));

const lead = {
  id: 'lead-1',
  nome: 'Maria da Silva',
  telefone: '(62) 99999-1234',
  email: 'maria@example.com',
  created_at: '2026-08-20T12:00:00.000Z',
  convertido: false,
};

describe('LeadsTable', () => {
  it('mascara o telefone do lead quando o modo privado está ligado', () => {
    const html = renderToStaticMarkup(<LeadsTable leads={[lead]} />);

    expect(html).toContain('••••••••');
    expect(html).not.toContain('(62) 99999-1234');
  });
});
