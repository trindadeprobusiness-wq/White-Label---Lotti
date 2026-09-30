/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// O diálogo puxa store, Supabase, upload e plano. Nada disso importa para a
// regra testada aqui — que campo aparece para cada tipo de imóvel — então cada
// dependência vira o mínimo que deixa o componente renderizar.
vi.mock('@/stores/crmStore', () => ({
  useCRMStore: () => ({ addImovel: vi.fn(), fetchImoveis: vi.fn() }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useImovelFotos', () => ({
  useImovelFotos: () => ({ uploadFotos: vi.fn(), uploading: false, progress: 0 }),
}));
vi.mock('@/hooks/useVideos', () => ({
  useVideos: () => ({ uploadVideo: vi.fn(), uploading: false, progress: 0 }),
}));
vi.mock('@/hooks/useSubscription', () => ({ useCheckLimit: () => vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('./ImovelFotosUpload', () => ({ ImovelFotosUpload: () => null }));
vi.mock('./ImovelMediaManager', () => ({ ImovelMediaManager: () => null }));

import { NovoImovelDialog } from './NovoImovelDialog';

const abrir = () =>
  render(<NovoImovelDialog open onOpenChange={vi.fn()} />);

describe('NovoImovelDialog — campos conforme o tipo', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('mostra dormitórios e suítes no padrão residencial (apartamento)', () => {
    abrir();

    expect(screen.getByText('Dorms')).toBeTruthy();
    expect(screen.getByText('Suítes')).toBeTruthy();
    expect(screen.getByText('Banheiros')).toBeTruthy();
    expect(screen.getByText('Vagas')).toBeTruthy();
  });

  it('não pede proprietário no cadastro novo — o campo bloqueava a criação rápida', () => {
    abrir();

    expect(screen.queryByText(/Proprietário/)).toBeNull();
  });

  it('esconde dormitório e suíte em imóvel comercial — galpão e sala não têm', () => {
    render(
      <NovoImovelDialog
        open
        onOpenChange={vi.fn()}
        imovelToEdit={{ id: 'i1', titulo: 'GALPÃO PARA ALUGUEL', tipo: 'COMERCIAL', finalidade: 'LOCACAO' }}
      />,
    );

    expect(screen.queryByText('Dorms')).toBeNull();
    expect(screen.queryByText('Suítes')).toBeNull();
    // Banheiro e vaga continuam: galpão tem os dois.
    expect(screen.getByText('Banheiros')).toBeTruthy();
    expect(screen.getByText('Vagas')).toBeTruthy();
  });

  it('em terreno não sobra nenhum campo de cômodo', () => {
    render(
      <NovoImovelDialog
        open
        onOpenChange={vi.fn()}
        imovelToEdit={{ id: 'i2', titulo: 'Lote', tipo: 'TERRENO', finalidade: 'VENDA' }}
      />,
    );

    expect(screen.queryByText('Dorms')).toBeNull();
    expect(screen.queryByText('Suítes')).toBeNull();
    expect(screen.queryByText('Banheiros')).toBeNull();
    expect(screen.queryByText('Vagas')).toBeNull();
    expect(screen.getByText('Área (m²)')).toBeTruthy();
  });

  it('mantém proprietário na edição, onde contrato e repasse dependem do nome', () => {
    render(
      <NovoImovelDialog
        open
        onOpenChange={vi.fn()}
        imovelToEdit={{ id: 'i1', titulo: 'Galpão', tipo: 'COMERCIAL', finalidade: 'LOCACAO' }}
      />,
    );

    expect(screen.getByText(/Proprietário/)).toBeTruthy();
  });
});
