import { describe, expect, it } from 'vitest';
import { buildAttachmentPath, buildStartBridgeRequest, parseLottiRequest, sanitizeConnectionPhone, sanitizeConnectionTimestamp } from './request';

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

describe('upload privado de anexo',()=>{
 it('valida o arquivo e cria caminho preso ao dono e ao request',()=>{
  const parsed=parseLottiRequest({action:'prepare_upload',request_id:requestId,name:'Contrato final.pdf',mime:'application/pdf',size:80*1024*1024});
  expect(buildAttachmentPath(parsed,'owner-id')).toBe('owner-id/11111111-1111-4111-8111-111111111111/Contrato-final.pdf');
 });
 it('aceita os MIME alternativos usados pelo navegador para CSV e ZIP',()=>{
  expect(parseLottiRequest({action:'prepare_upload',request_id:requestId,name:'leads.csv',mime:'application/vnd.ms-excel',size:1024})).toMatchObject({action:'prepare_upload',mime:'application/vnd.ms-excel'});
  expect(parseLottiRequest({action:'prepare_upload',request_id:requestId,name:'documentos.zip',mime:'application/x-zip-compressed',size:1024})).toMatchObject({action:'prepare_upload',mime:'application/x-zip-compressed'});
 });
 it('recusa script e arquivo maior que 100 MB',()=>{
  expect(()=>parseLottiRequest({action:'prepare_upload',request_id:requestId,name:'roubo.ps1',mime:'application/octet-stream',size:10})).toThrow('invalid_file');
  expect(()=>parseLottiRequest({action:'prepare_upload',request_id:requestId,name:'contrato.pdf',mime:'application/pdf',size:100*1024*1024+1})).toThrow('invalid_file');
 });
});

describe('estado da conexão', () => {
  it('preserva somente um telefone válido retornado pela ponte', () => {
    expect(sanitizeConnectionPhone('556281149611@s.whatsapp.net')).toBe('556281149611');
    expect(sanitizeConnectionPhone('../../segredo')).toBeUndefined();
    expect(sanitizeConnectionTimestamp('2026-09-22T17:00:00.000Z')).toBe('2026-09-22T17:00:00.000Z');
    expect(sanitizeConnectionTimestamp('ontem')).toBeUndefined();
  });
});
