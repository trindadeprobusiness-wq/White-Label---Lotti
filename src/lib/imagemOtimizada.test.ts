/**
 * O risco aqui é silencioso: se a URL transformada estiver errada, a landing
 * do QR fica SEM imagem — e é a tela onde o lead entra. Por isso todo caso
 * que não é Storage público precisa voltar intacto.
 */
import { describe, it, expect } from 'vitest';
import { imagemRedimensionada, imagemComFallback } from './imagemOtimizada';

const STORAGE = 'https://x.supabase.co/storage/v1/object/public/imoveis-fotos/a/b.jpg';

describe('imagemRedimensionada', () => {
  it('troca object por render e aplica largura e qualidade', () => {
    const r = imagemRedimensionada(STORAGE, { largura: 480, qualidade: 35 });
    expect(r).toContain('/storage/v1/render/image/public/');
    expect(r).toContain('width=480');
    expect(r).toContain('quality=35');
  });

  it('usa qualidade 60 por padrão', () => {
    expect(imagemRedimensionada(STORAGE, { largura: 800 })).toContain('quality=60');
  });

  it('preserva query string existente', () => {
    const r = imagemRedimensionada(STORAGE + '?v=2', { largura: 480 });
    expect(r).toContain('?v=2&width=480');
  });

  it('devolve intacta a URL que não é do Storage público', () => {
    // Imagem externa, data URI ou caminho relativo não podem ser reescritos.
    for (const u of ['https://cdn.exemplo.com/foto.jpg', '/local.png', 'data:image/png;base64,xx']) {
      expect(imagemRedimensionada(u, { largura: 480 })).toBe(u);
    }
  });

  it('nulo e vazio viram string vazia, não "undefined"', () => {
    expect(imagemRedimensionada(null, { largura: 480 })).toBe('');
    expect(imagemRedimensionada(undefined, { largura: 480 })).toBe('');
  });
});

describe('imagemComFallback', () => {
  it('devolve src transformado', () => {
    expect(imagemComFallback(STORAGE, 480).src).toContain('render/image');
  });

  it('no erro, volta para a original uma única vez', () => {
    const props = imagemComFallback(STORAGE, 480);
    const img = { src: props.src } as HTMLImageElement;
    props.onError({ currentTarget: img } as never);
    expect(img.src).toBe(STORAGE);

    // Segunda falha (a original também quebrou): não pode reatribuir e
    // entrar em laço infinito de onError.
    const antes = img.src;
    props.onError({ currentTarget: img } as never);
    expect(img.src).toBe(antes);
  });

  it('sem url, não quebra', () => {
    const props = imagemComFallback(null, 480);
    expect(props.src).toBe('');
  });
});
