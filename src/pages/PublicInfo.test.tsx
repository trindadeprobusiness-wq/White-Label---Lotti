import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

type PublicPages = {
  PaginaInicialPublica: ComponentType;
  PoliticaPrivacidade: ComponentType;
  TermosUso: ComponentType;
};

async function loadPublicPages(): Promise<PublicPages> {
  const modulePath = './PublicInfo';
  let loaded: PublicPages | null = null;

  try {
    loaded = await import(/* @vite-ignore */ modulePath) as PublicPages;
  } catch {
    // A asserção abaixo registra uma falha legível enquanto a página ainda
    // não existe no ciclo RED do TDD.
  }

  expect(loaded, 'as páginas públicas da Lotti ainda não foram implementadas').not.toBeNull();
  return loaded!;
}

function renderPage(Page: ComponentType, location: string) {
  return renderToStaticMarkup(
    <StaticRouter location={location}>
      {createElement(Page)}
    </StaticRouter>,
  );
}

describe('páginas públicas exigidas para o OAuth', () => {
  it('explica o produto e oferece uma entrada clara para a Lotti', async () => {
    const { PaginaInicialPublica } = await loadPublicPages();
    const html = renderPage(PaginaInicialPublica, '/sobre');

    expect(html).toContain('CRM imobiliário');
    expect(html).toContain('Clientes, imóveis e negociações. Cada próximo passo à vista.');
    expect(html).toContain('A Lotti cuida do repetitivo. O corretor entra no momento certo.');
    expect(html).toContain('Responde na hora');
    expect(html).toContain('Mapeia faixa de preço, região, entrada e financiamento');
    expect(html).toContain('Conecta o interesse aos imóveis disponíveis');
    expect(html).toContain('Faz follow-up no tempo certo');
    expect(html).toContain('mais tempo para negociar');
    expect(html).toContain('Google Agenda');
    // Os botões "Entrar" e "Entrar na Lotti" apontam para o subdomínio
    // app.plataformalotti.com.br, garantindo que visitantes do site
    // institucional (plataformalotti.com.br) cheguem ao app correto.
    expect(html).toContain('href="https://app.plataformalotti.com.br"');
  });

  it('declara como os dados do Google são acessados, usados, armazenados e excluídos', async () => {
    const { PoliticaPrivacidade } = await loadPublicPages();
    const html = renderPage(PoliticaPrivacidade, '/politica-de-privacidade');

    expect(html).toContain('calendar.events');
    expect(html).toContain('calendar.calendarlist.readonly');
    expect(html).toContain('tokens OAuth são criptografados');
    expect(html).toContain('não vende dados do Google');
    expect(html).toContain('Desconectar Google Agenda');
  });

  it('publica termos de uso com regras de conta, integração e encerramento', async () => {
    const { TermosUso } = await loadPublicPages();
    const html = renderPage(TermosUso, '/termos-de-uso');

    expect(html).toContain('responsável pela sua conta');
    expect(html).toContain('serviços de terceiros');
    expect(html).toContain('encerrar a integração');
  });
});
