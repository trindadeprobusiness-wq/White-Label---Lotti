import { describe, expect, it, vi } from 'vitest';
import { preloadRoute, preloadRotaDeEntrada, SIDEBAR_ROUTE_LOADERS, conversasLoader, disparosLoader } from './routePreloaders';

describe('preloadRoute', () => {
  it('preloads the matching sidebar route', async () => {
    const imoveisLoader = vi.fn().mockResolvedValue({});

    await preloadRoute('/imoveis', { '/imoveis': imoveisLoader });

    expect(imoveisLoader).toHaveBeenCalledOnce();
  });

  it('uses the parent route loader for detail URLs', async () => {
    const clientesLoader = vi.fn().mockResolvedValue({});

    await preloadRoute('/clientes/123', { '/clientes': clientesLoader });

    expect(clientesLoader).toHaveBeenCalledOnce();
  });

  it('does nothing for an unknown route', async () => {
    const loader = vi.fn().mockResolvedValue({});

    await preloadRoute('/desconhecida', { '/imoveis': loader });

    expect(loader).not.toHaveBeenCalled();
  });

  it('Conversas pré-carrega a tela de Conversas (não a demonstração) e Disparos tem pré-carregamento', () => {
    expect(SIDEBAR_ROUTE_LOADERS['/whatsapp']).toBe(conversasLoader);
    expect(SIDEBAR_ROUTE_LOADERS['/automacoes']).toBe(disparosLoader);
  });
});

describe('preloadRotaDeEntrada', () => {
  it('baixa a tela da rota exata e ignora detalhe, rota pública e falha', async () => {
    const clientes = vi.fn().mockResolvedValue({});
    const quebrado = vi.fn().mockRejectedValue(new Error('chunk'));
    const loaders = { '/clientes': clientes, '/': quebrado };

    preloadRotaDeEntrada('/clientes/', loaders);
    preloadRotaDeEntrada('/clientes/123', loaders);
    preloadRotaDeEntrada('/auth', loaders);
    preloadRotaDeEntrada('/', loaders);
    await Promise.resolve();

    expect(clientes).toHaveBeenCalledOnce();
    expect(quebrado).toHaveBeenCalledOnce();
  });
});
