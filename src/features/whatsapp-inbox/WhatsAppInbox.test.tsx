import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  WhatsAppInbox,
  filterConversations,
  findFunnelOpportunityForConversation,
  toggleProfileVisibility,
} from './WhatsAppInbox';
import { demoConversations } from './demoData';
import WhatsAppInboxPage from '@/pages/WhatsAppInbox';

vi.mock('@/hooks/crm/useCrm', () => ({
  ETAPAS_LEGADO: [
    { id: 'QUALIFICACAO', nome: 'Qualificação', tipo: 'ABERTA', ordem: 1, cor: 'blue', ativo: true, corretor_id: '' },
    { id: 'VISITA_PROPOSTA', nome: 'Visita / Proposta', tipo: 'ABERTA', ordem: 2, cor: 'amber', ativo: true, corretor_id: '' },
  ],
  useEtapas: () => ({ data: [
    { id: 'QUALIFICACAO', nome: 'Qualificação', tipo: 'ABERTA', ordem: 1, cor: 'blue', ativo: true, corretor_id: '' },
    { id: 'VISITA_PROPOSTA', nome: 'Visita / Proposta', tipo: 'ABERTA', ordem: 2, cor: 'amber', ativo: true, corretor_id: '' },
  ] }),
  useOportunidades: () => ({ data: [] }),
  useMoverOportunidade: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('WhatsAppInbox', () => {
  it('renderiza o fluxo completo de atendimento e identifica a demonstração', () => {
    const html = renderToStaticMarkup(<WhatsAppInbox />);

    expect(html).toContain('Conversas');
    expect(html).not.toContain('Abrir atendimento conectado');
    expect(html).toContain('Perfil do contato');
    expect(html).toContain('Modo demonstração');
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

  it('liga a etapa exibida à oportunidade do mesmo cliente ou telefone', () => {
    const conversation = demoConversations[0];
    const byClient = findFunnelOpportunityForConversation(conversation, [
      { id: 'op-1', cliente_id: conversation.contactId, etapa_id: 'QUALIFICACAO' },
    ]);
    const byPhone = findFunnelOpportunityForConversation(conversation, [
      { id: 'op-2', cliente_id: 'outro', etapa_id: 'VISITA_PROPOSTA', clientes: { telefone: conversation.phone } },
    ]);

    expect(byClient?.id).toBe('op-1');
    expect(byPhone?.id).toBe('op-2');
  });

  it('permite trocar a etapa do Funil diretamente no Inbox', () => {
    const html = renderToStaticMarkup(<WhatsAppInbox />);

    expect(html).toContain('aria-label="Alterar etapa do funil"');
    expect(html).toContain('Qualificação');
    expect(html).toContain('Visita / Proposta');
  });

  it('mantém a estrutura compacta de filtros e três caixas independentes', () => {
    const html = renderToStaticMarkup(<WhatsAppInbox />);

    expect(html).toContain('Filtros');
    expect(html).toContain('Atrasando: 0 conversas');
    expect(html).toContain('Urgente: 0 conversas');
    expect(html).toContain('data-panel="conversations"');
    expect(html).toContain('data-panel="chat"');
    expect(html).toContain('data-panel="contact-profile"');
  });

  it('usa a escala compacta da referência no desktop', () => {
    const html = renderToStaticMarkup(<WhatsAppInbox />);

    expect(html).toContain('2xl:grid-cols-[290px_minmax(0,1fr)_310px]');
    expect(html).toContain('min-h-[60px]');
    expect(html).toContain('data-avatar-size="compact"');
    expect(html).toContain('data-density="compact"');
  });
});
