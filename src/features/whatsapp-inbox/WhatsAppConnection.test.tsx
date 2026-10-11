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
 expect(screen.getByText(/Entre em Aparelhos conectados/)).not.toBeNull();
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
 let started=false;
 invoke.mockImplementation((_name,options)=>{
   if(options.body.action==='connect')started=true;
   return Promise.resolve({data:started?{state:'connecting',agentEnabled:false,qr:'data:image/png;base64,test',qrExpiresAt:expiresAt}:{state:'disconnected',agentEnabled:false},error:null});
 });
 mount();await advance();fireEvent.click(screen.getByText('Conectar WhatsApp'));await advance();
 expect(screen.queryByAltText('QR Code atualizado para conectar seu WhatsApp')).not.toBeNull();
 await advance(11000);
 expect(screen.queryByAltText('QR Code atualizado para conectar seu WhatsApp')).toBeNull();
 expect(invoke.mock.calls.filter(c=>c[1].body.action==='connect')).toHaveLength(1);
 fireEvent.click(screen.getByText('Cancelar'));await advance(16000);
 expect(invoke.mock.calls.every(c=>['status','connect'].includes(c[1].body.action))).toBe(true);
 expect(invoke.mock.calls.filter(c=>c[1].body.action==='connect')).toHaveLength(1);
});
it('connect recusado: a tela oferece refazer o connect, não o status, e o caminho não some',async()=>{
 // O erro vinha do connect, mas "Tentar novamente" refazia a consulta de
 // status — repetia o que não tinha falhado e deixava a tela sem saída.
 invoke.mockImplementation((_name,options)=>options.body.action==='connect'
   ?Promise.resolve({data:null,error:new Error('connection_service_unavailable')})
   :Promise.resolve({data:{state:'disconnected',agentEnabled:false},error:null}));
 mount({autoStart:true});await advance();
 expect(screen.getByText(/gerar o QR Code/i)).not.toBeNull();
 const antes=invoke.mock.calls.filter(c=>c[1].body.action==='connect').length;
 fireEvent.click(screen.getByText('Tentar de novo'));await advance();
 expect(invoke.mock.calls.filter(c=>c[1].body.action==='connect')).toHaveLength(antes+1);
 // Mesmo com autoStart, sempre sobra um botão para pedir o QR de novo.
 expect(screen.getByText('Gerar QR Code')).not.toBeNull();
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
it('não pede nova conexão enquanto o WhatsApp está reconectando, para não derrubar a sessão',async()=>{
 invoke.mockResolvedValue({data:{state:'connecting',agentEnabled:false},error:null});
 mount({autoStart:true});await advance(5000);
 expect(invoke.mock.calls.filter(call=>call[1].body.action==='connect')).toHaveLength(0);
 expect(screen.getByText(/reconectando/i)).not.toBeNull();
});
it('mostra de novo o QR que já espera leitura quando a página abre, sem pedir outra conexão',async()=>{
 invoke.mockResolvedValue({data:{state:'connecting',agentEnabled:false,qr:'data:image/png;base64,pendente',qrExpiresAt:Date.now()+30000},error:null});
 mount({autoStart:true});await advance(3000);
 expect(screen.getByAltText('QR Code atualizado para conectar seu WhatsApp').getAttribute('src')).toBe('data:image/png;base64,pendente');
 expect(screen.queryByText(/reconectando/i)).toBeNull();
 expect(invoke.mock.calls.filter(call=>call[1].body.action==='connect')).toHaveLength(0);
 fireEvent.click(screen.getByText('Cancelar'));await advance(3000);
 expect(screen.queryByAltText('QR Code atualizado para conectar seu WhatsApp')).toBeNull();
});
it('token divergente deixa de ser "indisponível" e passa a dizer o que é',async()=>{
 // Os dois lados guardam o mesmo segredo e nada os compara. Quando divergem, a
 // ponte recusa — e a tela dizia apenas que não foi possível consultar.
 const recusa=Object.assign(new Error('http'),{context:{json:async()=>({error:'bridge_rejected'})}});
 invoke.mockResolvedValue({data:null,error:recusa});
 mount();await advance(5000);
 expect(screen.getByRole('alert').textContent).toContain('credenciais diferentes');
});
it('não pede conexão quando o estado não pôde ser consultado',async()=>{
 invoke.mockResolvedValue({data:null,error:new Error('indisponível')});
 mount({autoStart:true});await advance(5000);
 expect(invoke.mock.calls.filter(call=>call[1].body.action==='connect')).toHaveLength(0);
});
it('passados 2 minutos sem leitura, gera outro QR sozinho (até 10 minutos) e só então mostra o aviso',async()=>{
 invoke.mockImplementation((_name,options)=>Promise.resolve({data:options.body.action==='connect'?{state:'connecting',agentEnabled:false,qr:'data:image/png;base64,test',qrExpiresAt:Date.now()+60000}:{state:'disconnected',agentEnabled:false},error:null}));
 mount();await advance();fireEvent.click(screen.getByText('Conectar WhatsApp'));await advance();
 const conexoes=()=>invoke.mock.calls.filter(c=>c[1].body.action==='connect').length;
 expect(conexoes()).toBe(1);
 await advance(121000);
 expect(conexoes()).toBe(2);
 expect(screen.queryByText(/não confirmou a conexão em dois minutos/)).toBeNull();
 for(let i=0;i<3;i++)await advance(121000);
 expect(conexoes()).toBe(5);
 await advance(121000);
 expect(conexoes()).toBe(5);
 expect(screen.getByText(/não confirmou a conexão em dois minutos/)).not.toBeNull();
});
