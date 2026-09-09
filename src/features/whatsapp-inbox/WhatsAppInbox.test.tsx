import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WhatsAppInbox, filterConversations } from './WhatsAppInbox';
import { demoConversations } from './demoData';

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
});
