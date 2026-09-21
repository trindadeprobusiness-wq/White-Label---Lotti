import { describe, expect, it } from 'vitest';
import { buildStartBridgeRequest, parseLottiRequest } from './request';

const requestId = '11111111-1111-4111-8111-111111111111';

describe('contrato de nova conversa', () => {
  it('normaliza o telefone brasileiro e os campos', () => {
    expect(parseLottiRequest({ action: 'start', phone: '(62) 99999-9999', name: ' Maria ', text: ' Olá ', request_id: requestId }))
      .toEqual({ action: 'start', phone: '5562999999999', name: 'Maria', text: 'Olá', request_id: requestId });
  });
  it('recusa telefone e mensagem inválidos', () => {
    expect(() => parseLottiRequest({ action: 'start', phone: '12', text: 'Olá', request_id: requestId })).toThrow('invalid_phone');
    expect(() => parseLottiRequest({ action: 'start', phone: '5562999999999', text: '', request_id: requestId })).toThrow('invalid_text');
  });
  it('reutiliza o envio manual com o id e request id resolvidos', () => {
    const parsed = parseLottiRequest({ action: 'start', phone: '5562999999999', text: 'Olá', request_id: requestId });
    expect(buildStartBridgeRequest(parsed, 'owner', 'conversation')).toEqual({ action: 'send', corretor_id: 'owner', conversation_id: 'conversation', request_id: requestId, kind: 'text', text: 'Olá' });
  });
});
