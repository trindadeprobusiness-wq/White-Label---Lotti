import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LeadsTable } from './LeadsTable';

vi.mock('@/stores/privacidadeStore', () => ({
  usePrivacidade: () => true,
}));

const lead = {
  id: 'lead-1',
  fachada_id: 'fachada-1',
  nome: 'Maria da Silva',
  telefone: '(62) 99999-1234',
  email: 'maria@example.com',
  created_at: '2026-08-20T12:00:00.000Z',
  convertido: false,
};

const fachada = {
  id: 'fachada-1', corretor_id: 'corretor-1', imovel_id: 'imovel-1',
  tipo_negocio: 'VENDA' as const, template_id: 'template-1',
  cta_principal: 'WHATSAPP' as const, modo_conversao: true, ativo: true,
  total_escaneamentos: 3, total_leads: 1, created_at: '2026-08-20T12:00:00.000Z',
  imovel: {
    titulo: 'Casa Jardim América', tipo: 'Casa', valor: 650000, area_m2: 180,
    dormitorios: 3, garagem: 2, endereco: 'Rua das Flores, 123',
    bairro: 'Jardim América', cidade: 'Goiânia', descricao: null,
  },
};

describe('LeadsTable', () => {
  it('mascara o telefone do lead quando o modo privado está ligado', () => {
    const html = renderToStaticMarkup(<LeadsTable leads={[lead]} fachadas={[fachada]} />);

    expect(html).toContain('••••••••');
    expect(html).not.toContain('(62) 99999-1234');
  });

  it('identifica em cada lead a fachada e o imóvel de origem', () => {
    const html = renderToStaticMarkup(<LeadsTable leads={[lead]} fachadas={[fachada]} />);
    expect(html).toContain('Fachada / imóvel');
    expect(html).toContain('Casa Jardim América');
    expect(html).toContain('Rua das Flores, 123, Jardim América, Goiânia');
  });

  it('explica quando a fachada selecionada ainda não possui leads', () => {
    const html = renderToStaticMarkup(
      <LeadsTable leads={[]} fachadas={[fachada]} fachadaSelecionadaId="fachada-1" />,
    );
    expect(html).toContain('Nenhum lead nesta fachada');
    expect(html).toContain('Casa Jardim América');
  });
});
