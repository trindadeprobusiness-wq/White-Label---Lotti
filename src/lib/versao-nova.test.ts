import { describe, expect, it } from 'vitest';
import { scriptDoHtml } from './versao-nova';

describe('scriptDoHtml', () => {
  it('acha o script principal do build no index.html', () => {
    const html = '<head><script type="module" crossorigin src="/assets/index-AbC123.js"></script><link rel="stylesheet" href="/assets/index-x.css"></head>';
    expect(scriptDoHtml(html)).toBe('/assets/index-AbC123.js');
  });
  it('ignora script de desenvolvimento e html sem script', () => {
    expect(scriptDoHtml('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
    expect(scriptDoHtml('<html></html>')).toBeNull();
  });
});
