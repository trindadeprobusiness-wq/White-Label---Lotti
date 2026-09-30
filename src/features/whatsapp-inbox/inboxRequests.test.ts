import { describe, expect, it } from 'vitest';
import { attemptFinished, functionErrorCode, mergeErrorText, nextStartAttempt, renameErrorText, startErrorText } from './inboxRequests';

describe('request_id de "Nova conversa"', () => {
  let n = 0;
  const newId = () => `id-${++n}`;
  it('mesmo telefone e texto reaproveitam o id; outro texto ou telefone ganham um novo', () => {
    const first = nextStartAttempt(null, '5562981234567', 'Olá', newId);
    expect(nextStartAttempt(first, '5562981234567', 'Olá', newId)).toBe(first);
    expect(nextStartAttempt(first, '5562981234567', 'Olá!', newId).id).not.toBe(first.id);
    expect(nextStartAttempt(first, '5562981234568', 'Olá', newId).id).not.toBe(first.id);
  });
  it('só entrega confirmada ou recusada encerram a tentativa', () => {
    expect(attemptFinished('sent')).toBe(true);
    expect(attemptFinished('failed')).toBe(true);
    for (const outcome of ['uncertain', 'sending', 'busy', 'start_failed']) expect(attemptFinished(outcome)).toBe(false);
  });
});

describe('mensagens das ações do Inbox', () => {
  it('explica cada recusa conhecida e cai numa mensagem genérica no resto', () => {
    expect(startErrorText('channel_unavailable')).toMatch(/Conecte o WhatsApp/);
    expect(startErrorText('duplicate_conversation_phone')).toMatch(/Já existe uma conversa com este telefone/);
    expect(startErrorText('x')).toBe('Não foi possível iniciar a conversa.');
    expect(renameErrorText('phone_in_other_conversation')).toMatch(/Una as duas/);
    expect(renameErrorText('delivery_pending')).toMatch(/envio em andamento/);
    expect(mergeErrorText('different_contacts')).toMatch(/contatos diferentes/);
  });
  it('lê o motivo que a Edge Function devolveu no corpo do erro', async () => {
    expect(await functionErrorCode({ context: { json: async () => ({ error: 'conversation_unavailable', reason: 'invalid_phone' }) } })).toBe('invalid_phone');
    expect(await functionErrorCode({ context: { json: async () => ({ error: 'send_unavailable' }) } })).toBe('send_unavailable');
    expect(await functionErrorCode({ context: { json: async () => { throw new Error('lido'); } } })).toBe('start_failed');
    expect(await functionErrorCode(new Error('rede'))).toBe('start_failed');
  });
});
