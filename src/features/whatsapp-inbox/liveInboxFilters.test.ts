import { describe, expect, it } from 'vitest';
import { conversationTitle, esperaResposta, filterLiveConversations, latestByConversation, liveUrgency, type LiveConversation } from './liveInboxFilters';

describe('nome do contato no Inbox real', () => {
  const base: LiveConversation = { id: '9', phone: '5562999999999', mode: 'human', updated_at: '2026-09-20T14:45:00Z', qualification: {} };
  it('prefere o nome editado no CRM, depois o nome do WhatsApp e por fim o número', () => {
    expect(conversationTitle({ ...base, contact_name: 'Maria (WhatsApp)' }, 'Maria Souza')).toBe('Maria Souza');
    expect(conversationTitle({ ...base, contact_name: 'Maria (WhatsApp)' }, 'Contato WhatsApp')).toBe('Maria (WhatsApp)');
    expect(conversationTitle({ ...base, contact_name: null })).toBe('+55 (62) 99999-9999');
    expect(conversationTitle({ ...base, phone: '556233334444', contact_name: null })).toBe('+55 (62) 3333-4444');
    expect(conversationTitle({ ...base, phone: '14155550100', contact_name: null })).toBe('+14155550100');
  });
  it('conversa com número oculto pelo WhatsApp não mostra número inventado', () => {
    expect(conversationTitle({ ...base, phone: null, contact_name: null })).toBe('Contato sem número');
    expect(conversationTitle({ ...base, phone: null, contact_name: 'Paula' })).toBe('Paula');
  });
  it('busca não quebra em conversa sem número', () => {
    const options = { query: 'pau', quick: 'all' as const, mode: '', stage: '', period: '', now: Date.parse('2026-09-20T15:00:00Z') };
    expect(filterLiveConversations([{ ...base, phone: null, contact_name: 'Paula' }, { ...base, id: '10', phone: null }], new Map(), options).map(c => c.id)).toEqual(['9']);
  });
  it('busca também pelo nome do contato', () => {
    const options = { query: 'mari', quick: 'all' as const, mode: '', stage: '', period: '', now: Date.parse('2026-09-20T15:00:00Z') };
    expect(filterLiveConversations([{ ...base, contact_name: 'Mariana' }, { ...base, id: '10' }], new Map(), options).map(c => c.id)).toEqual(['9']);
  });
});

const now = Date.parse('2026-09-20T15:00:00Z');
const conversation: LiveConversation = { id: '1', phone: '5562999999999', mode: 'human', updated_at: '2026-09-20T14:45:00Z', qualification: { stage: 'qualificando' } };

describe('filtros do Inbox real', () => {
  it('classifica atraso apenas quando a última mensagem aguarda resposta humana', () => {
    expect(liveUrgency(conversation, { conversation_id: '1', direction: 'in', created_at: '2026-09-20T14:30:00Z', content: 'Olá' }, now)).toBe('late');
    expect(liveUrgency(conversation, { conversation_id: '1', direction: 'out', created_at: '2026-09-20T14:30:00Z', content: 'Olá' }, now)).toBe('all');
    expect(liveUrgency({ ...conversation, mode: 'ai' }, { conversation_id: '1', direction: 'in', created_at: '2026-09-20T13:00:00Z', content: 'Olá' }, now)).toBe('all');
  });

  it('filtra busca, responsável pelo atendimento, etapa, período e urgência', () => {
    const latest = latestByConversation([
      { conversation_id: '1', direction: 'in', created_at: '2026-09-20T13:00:00Z', content: 'Quero um apartamento' },
      { conversation_id: '1', direction: 'out', created_at: '2026-09-20T12:00:00Z', content: 'Mensagem antiga' },
    ]);
    const options = { query: 'apartamento', quick: 'urgent' as const, mode: 'human', stage: 'qualificando', period: '7', now };
    expect(filterLiveConversations([conversation], latest, options)).toHaveLength(1);
    expect(filterLiveConversations([conversation], latest, { ...options, mode: 'ai' })).toHaveLength(0);
  });
});

describe('quem espera resposta', () => {
  const agora = Date.parse('2026-09-30T12:00:00Z');
  const ha = (minutos: number) => ({
    conversation_id: 'c1',
    direction: 'in' as const,
    created_at: new Date(agora - minutos * 60_000).toISOString(),
    content: 'oi',
  });

  it('conta quem escreveu há pouco, que liveUrgency ainda não marca como atrasada', () => {
    const conversa = { mode: 'human' as const, qualification: {} };

    // Cinco minutos: espera resposta, mas ainda não está atrasada.
    expect(esperaResposta(conversa, ha(5))).toBe(true);
    expect(liveUrgency(conversa, ha(5), agora)).toBe('all');
  });

  it('não conta conversa cuja última mensagem foi nossa', () => {
    expect(esperaResposta({ mode: 'human' }, { ...ha(5), direction: 'out' })).toBe(false);
  });

  it('não conta conversa que está com a IA', () => {
    expect(esperaResposta({ mode: 'ai' }, ha(5))).toBe(false);
  });

  it('não conta conversa sem mensagem alguma', () => {
    expect(esperaResposta({ mode: 'human' }, undefined)).toBe(false);
  });
});
