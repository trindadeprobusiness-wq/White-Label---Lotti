import { describe, expect, it, vi } from 'vitest';
import { preloadRoute } from './routePreloaders';

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
});
