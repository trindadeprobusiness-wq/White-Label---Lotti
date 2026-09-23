// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WhatsAppConnection } from './WhatsAppConnection';
const { invoke } = vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'test-owner'}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke}}}));
beforeEach(()=>{vi.useFakeTimers();invoke.mockReset();});
afterEach(()=>{cleanup();vi.useRealTimers();});
async function advance(ms=100){await act(async()=>{await vi.advanceTimersByTimeAsync(ms)});}
function mount(props: Parameters<typeof WhatsAppConnection>[0] = {}){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><WhatsAppConnection {...props}/></QueryClientProvider>);}
it('inicia o QR automaticamente quando usado como bloqueio do Inbox',async()=>{
 invoke.mockImplementation((_name,options)=>Promise.resolve({data:options.body.action==='connect'
   ?{state:'connecting',agentEnabled:false,qr:'data:image/png;base64,test',qrExpiresAt:Date.now()+10000}
   :{state:'disconnected',agentEnabled:false},error:null}));
 mount({autoStart:true});await advance();
 expect(screen.queryByAltText('QR Code atualizado para conectar seu WhatsApp')).not.toBeNull();
 expect(screen.getByText(/WhatsApp → Configurações → Aparelhos conectados/)).not.toBeNull();
 expect(invoke.mock.calls.filter(call=>call[1].body.action==='connect')).toHaveLength(1);
});
it('mantém o QR ilustrativo visível sem aplicar a expiração real',async()=>{
 invoke.mockResolvedValue({data:{state:'disconnected',agentEnabled:false},error:null});
 mount({previewPairing:true});await advance(121000);
 expect(screen.queryByAltText('QR Code de demonstração para conectar seu WhatsApp')).not.toBeNull();
 expect(screen.queryByText(/tentativa nesta tela foi encerrada/i)).toBeNull();
});
it('starts once, polls read-only, expires a QR locally and cancels without logout',async()=>{
 const expiresAt=Date.now()+10000;
 invoke.mockResolvedValue({data:{state:'connecting',agentEnabled:false,qr:'data:image/png;base64,test',qrExpiresAt:expiresAt},error:null});
 mount();await advance();fireEvent.click(screen.getByText('Conectar WhatsApp'));await advance();
 expect(screen.queryByAltText('QR Code atualizado para conectar seu WhatsApp')).not.toBeNull();
 await advance(11000);
 expect(screen.queryByAltText('QR Code atualizado para conectar seu WhatsApp')).toBeNull();
 expect(invoke.mock.calls.filter(c=>c[1].body.action==='connect')).toHaveLength(1);
 fireEvent.click(screen.getByText('Cancelar'));await advance(16000);
 expect(invoke.mock.calls.every(c=>['status','connect'].includes(c[1].body.action))).toBe(true);
 expect(invoke.mock.calls.filter(c=>c[1].body.action==='connect')).toHaveLength(1);
});
it('shows connected only on provider confirmation and offers no new pairing',async()=>{
 invoke.mockResolvedValue({data:{state:'connected',agentEnabled:false},error:null});
 mount();await advance();
 expect(screen.queryByText('WhatsApp conectado')).not.toBeNull();
 expect(screen.queryByText('Conectar WhatsApp')).toBeNull();
 expect(invoke.mock.calls.every(c=>c[1].body.action==='status')).toBe(true);
});
it('exibe o QR devolvido pela conexão sem esperar outra consulta de status',async()=>{
 invoke.mockImplementation((_name,options)=>Promise.resolve({data:options.body.action==='connect'
   ?{state:'connecting',agentEnabled:false,qr:'data:image/png;base64,test',qrExpiresAt:Date.now()+10000}
   :{state:'disconnected',agentEnabled:false},error:null}));
 mount();await advance();
 const prior=invoke.mock.calls.filter(call=>call[1].body.action==='status').length;
 fireEvent.click(screen.getByText('Conectar WhatsApp'));await advance();
 expect(screen.queryByAltText('QR Code atualizado para conectar seu WhatsApp')).not.toBeNull();
 expect(invoke.mock.calls.filter(call=>call[1].body.action==='status')).toHaveLength(prior);
});
it('mantém o último QR válido durante uma consulta temporariamente sem código',async()=>{
 const qr='data:image/png;base64,stable';
 const expiresAt=Date.now()+30000;
 let statusCalls=0;
 invoke.mockImplementation((_name,options)=>{
   if(options.body.action==='connect')return Promise.resolve({data:{state:'connecting',agentEnabled:false,qr,qrExpiresAt:expiresAt},error:null});
   statusCalls++;
   return Promise.resolve({data:statusCalls===1
     ?{state:'disconnected',agentEnabled:false}
     :{state:'connecting',agentEnabled:false},error:null});
 });
 mount();await advance();fireEvent.click(screen.getByText('Conectar WhatsApp'));await advance();
 const image=screen.getByAltText('QR Code atualizado para conectar seu WhatsApp');
 expect(image.getAttribute('src')).toBe(qr);
 await advance(2100);
 expect(screen.getByAltText('QR Code atualizado para conectar seu WhatsApp').getAttribute('src')).toBe(qr);
});
