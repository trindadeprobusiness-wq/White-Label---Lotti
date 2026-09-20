import { describe, expect, it } from 'vitest';
import { filterLiveConversations, latestByConversation, liveUrgency, type LiveConversation } from './liveInboxFilters';

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
