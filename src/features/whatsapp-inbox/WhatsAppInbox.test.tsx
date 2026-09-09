import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WhatsAppInbox, filterConversations, toggleProfileVisibility } from './WhatsAppInbox';
import { demoConversations } from './demoData';
import WhatsAppInboxPage from '@/pages/WhatsAppInbox';

describe('WhatsAppInbox', () => {
  it('renderiza o fluxo completo de atendimento e identifica a demonstração', () => {
    const html = renderToStaticMarkup(<WhatsAppInbox />);

    expect(html).toContain('Conversas');
    expect(html).toContain('Perfil do contato');
    expect(html).toContain('Conexão demonstrativa');
    expect(html).toContain('Atendimento humano');
    expect(html).toContain('Notas internas');
  });

  it('filtra por nome, telefone e conteúdo da última mensagem', () => {
    expect(filterConversations(demoConversations, 'marina')).toHaveLength(1);
    expect(filterConversations(demoConversations, '98765')).toHaveLength(1);
    expect(filterConversations(demoConversations, 'financiamento')).toHaveLength(1);
    expect(filterConversations(demoConversations, 'inexistente')).toHaveLength(0);
  });

  it('usa toda a área do app sem cabeçalho externo acima do inbox', () => {
    const html = renderToStaticMarkup(<WhatsAppInboxPage />);

    expect(html).not.toContain('Atenda seus contatos e acompanhe cada conversa');
    expect(html).toContain('data-layout="full-inbox"');
  });

  it('mostra a linha do tempo antes dos controles internos do contato', () => {
    const html = renderToStaticMarkup(<WhatsAppInbox />);

    expect(html.indexOf('Linha do tempo')).toBeLessThan(html.indexOf('Responsável'));
    expect(html.indexOf('Linha do tempo')).toBeLessThan(html.indexOf('Notas internas'));
  });

  it('permite ocultar o perfil para ampliar o chat e reabrir depois', () => {
    const html = renderToStaticMarkup(<WhatsAppInbox />);

    expect(html).toContain('Ocultar info');
    expect(toggleProfileVisibility(true)).toBe(false);
    expect(toggleProfileVisibility(false)).toBe(true);
  });

  it('mantém a estrutura compacta de filtros e três caixas independentes', () => {
    const html = renderToStaticMarkup(<WhatsAppInbox />);

    expect(html).toContain('Filtros');
    expect(html).toContain('Aguardando resposta');
    expect(html).toContain('Conversas prioritárias');
    expect(html).toContain('data-panel="conversations"');
    expect(html).toContain('data-panel="chat"');
    expect(html).toContain('data-panel="contact-profile"');
  });

  it('usa a escala compacta da referência no desktop', () => {
    const html = renderToStaticMarkup(<WhatsAppInbox />);

    expect(html).toContain('2xl:grid-cols-[310px_minmax(0,1fr)_330px]');
    expect(html).toContain('min-h-[64px]');
    expect(html).toContain('data-avatar-size="compact"');
    expect(html).toContain('data-density="compact"');
  });
});
