import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarHeaderAction } from './GoogleCalendarHeaderAction';

describe('ação do Google Agenda no cabeçalho da Rotina', () => {
  it('oferece conexão direta e rótulo compacto para celular', () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarHeaderAction connected={false} pending={false} onConnect={vi.fn()} />,
    );

    expect(html).toContain('Conectar Google Agenda');
    expect(html).toContain('Google Agenda');
    expect(html).toContain('hidden sm:inline');
    expect(html).toContain('sm:hidden');
    expect(html).toContain('min-h-11');
  });

  it('mostra somente o estado conectado sem apontar para um painel duplicado', () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarHeaderAction connected pending={false} onConnect={vi.fn()} />,
    );

    expect(html).toContain('Agenda conectada');
    expect(html).not.toContain('Configurar agenda');
    expect(html).toContain('disabled=""');
  });
});
