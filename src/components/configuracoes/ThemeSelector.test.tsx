import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThemeSelector } from './ThemeSelector';

describe('ThemeSelector', () => {
  it('oferece somente os temas claro e escuro em uma grade responsiva', () => {
    const html = renderToStaticMarkup(
      <ThemeSelector value="light" onValueChange={vi.fn()} />,
    );

    expect(html).toContain('>Claro<');
    expect(html).toContain('>Escuro<');
    expect(html).not.toContain('>Sistema<');
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('sm:grid-cols-2');
  });
});
