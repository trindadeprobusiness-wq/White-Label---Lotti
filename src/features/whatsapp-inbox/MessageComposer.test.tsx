// @vitest-environment jsdom
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MessageComposer} from './MessageComposer';
const {invoke,uploadToSignedUrl}=vi.hoisted(()=>({invoke:vi.fn(),uploadToSignedUrl:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke},storage:{from:()=>({uploadToSignedUrl})}}}));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals()});
it('sends text from the selected conversation and clears only after confirmation',async()=>{
 invoke.mockResolvedValue({data:{sendStatus:'sent'}});const sent=vi.fn();render(<MessageComposer conversationId="conversation-a" onSent={sent}/>);
 fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Olá, podemos agendar?'}});fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 await waitFor(()=>expect(sent).toHaveBeenCalledOnce());expect(invoke.mock.calls[0][1].body.conversation_id).toBe('conversation-a');expect((screen.getByLabelText('Mensagem') as HTMLTextAreaElement).value).toBe('');
});
it('reuses the same request after timeout rather than sending a duplicate',async()=>{
 invoke.mockResolvedValueOnce({error:new Error('timeout')}).mockResolvedValueOnce({data:{sendStatus:'sent'}});
 render(<MessageComposer conversationId="conversation-b" onSent={()=>{}}/>);fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Teste'}});fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 await screen.findByRole('button',{name:'Verificar envio'});fireEvent.click(screen.getByRole('button',{name:'Verificar envio'}));await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));expect(invoke.mock.calls[0][1].body.request_id).toBe(invoke.mock.calls[1][1].body.request_id);
});
it('depois de conferir no WhatsApp, o corretor escreve de novo com um request novo',async()=>{
 invoke.mockResolvedValueOnce({data:{sendStatus:'uncertain'}}).mockResolvedValueOnce({data:{sendStatus:'sent'}});
 render(<MessageComposer conversationId="conversation-c" onSent={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Primeira'}});fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 // Sem esta saída o campo fica travado até recarregar a página.
 const sair=await screen.findByRole('button',{name:/Já conferi no WhatsApp/});
 expect((screen.getByLabelText('Mensagem') as HTMLTextAreaElement).disabled).toBe(true);
 fireEvent.click(sair);
 expect((screen.getByLabelText('Mensagem') as HTMLTextAreaElement).disabled).toBe(false);
 fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Segunda'}});fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));
 expect(invoke.mock.calls[0][1].body.request_id).not.toBe(invoke.mock.calls[1][1].body.request_id);
});
it('renders the compact chat bar without native file controls',()=>{
 render(<MessageComposer conversationId="conversation-c" onSent={()=>{}}/>);
 expect(screen.getByPlaceholderText('Digite uma mensagem')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Anexar arquivo'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Gravar áudio'})).toBeTruthy();
 expect(screen.queryByText('Anexar arquivo')).toBeNull();
 expect(screen.queryByText('Gravações de até 90 segundos.')).toBeNull();
 expect(document.querySelector('input[type="file"]')?.className).toContain('sr-only');
});
it('uploads an allowed contract privately before asking the runtime to send it',async()=>{
 invoke.mockResolvedValueOnce({data:{path:'owner/request/contrato.pdf',token:'signed-upload'}}).mockResolvedValueOnce({data:{sendStatus:'sent'}});uploadToSignedUrl.mockResolvedValue({error:null});
 render(<MessageComposer conversationId="conversation-file" onSent={()=>{}}/>);const file=new File(['pdf'],'contrato.pdf',{type:'application/pdf'});
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[file]}});fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));expect(invoke.mock.calls[1][1].body).toMatchObject({kind:'file',name:'contrato.pdf',mime:'application/pdf',storage_path:'owner/request/contrato.pdf'});
});
it('keeps the message field available and sends a selected file with Enter',async()=>{
 invoke.mockResolvedValueOnce({data:{path:'owner/request/recibo.pdf',token:'signed-upload'}}).mockResolvedValueOnce({data:{sendStatus:'sent'}});uploadToSignedUrl.mockResolvedValue({error:null});
 render(<MessageComposer conversationId="conversation-file-enter" onSent={()=>{}}/>);const file=new File(['pdf'],'recibo.pdf',{type:'application/pdf'});
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[file]}});
 const message=screen.getByLabelText('Mensagem');fireEvent.keyDown(message,{key:'Enter',code:'Enter'});
 await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));expect(invoke.mock.calls[1][1].body).toMatchObject({conversation_id:'conversation-file-enter',kind:'file',name:'recibo.pdf'});
});
it('usa o compositor claro e retangular da referência sem alterar o envio',()=>{
 render(<MessageComposer conversationId="conversation-visual" onSent={()=>{}}/>);
 expect(screen.getByLabelText('Mensagem').parentElement?.className).toContain('rounded-xl');
 expect(screen.getByLabelText('Mensagem').parentElement?.className).toContain('bg-[#fbfcfe]');
 expect(screen.getByLabelText('Mensagem').parentElement?.className).toContain('focus-within:ring-primary/25');
});
it('returns keyboard focus to the message field after choosing a file',()=>{
 render(<MessageComposer conversationId="conversation-focus" onSent={()=>{}}/>);
 const file=new File(['pdf'],'contrato.pdf',{type:'application/pdf'});
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[file]}});
 expect(document.activeElement).toBe(screen.getByLabelText('Mensagem'));
});
it('prévia envia texto e arquivo ao callback local sem chamar Supabase',async()=>{
 const previewSend=vi.fn();render(<MessageComposer conversationId="preview" onSent={()=>{}} preview onPreviewSend={previewSend}/>);
 fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Teste local'}});
 fireEvent.keyDown(screen.getByLabelText('Mensagem'),{key:'Enter',code:'Enter'});
 expect(previewSend).toHaveBeenCalledWith({kind:'text',content:'Teste local'});
 const file=new File(['pdf'],'contrato.pdf',{type:'application/pdf'});
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[file]}});
 fireEvent.keyDown(screen.getByLabelText('Mensagem'),{key:'Enter',code:'Enter'});
 expect(previewSend).toHaveBeenCalledWith({kind:'file',content:'contrato.pdf'});
 expect(invoke).not.toHaveBeenCalled();
});
it('prévia simula gravar e enviar áudio sem pedir microfone nem chamar Supabase',()=>{
 const previewSend=vi.fn();render(<MessageComposer conversationId="preview-audio" onSent={()=>{}} preview onPreviewSend={previewSend}/>);
 fireEvent.click(screen.getByRole('button',{name:'Gravar áudio'}));
 fireEvent.click(screen.getByRole('button',{name:'Parar gravação'}));
 expect(screen.getByText('Áudio de demonstração')).not.toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 expect(previewSend).toHaveBeenCalledWith({kind:'audio',content:'Áudio de demonstração'});
 expect(invoke).not.toHaveBeenCalled();
});
it('preserves typed text after sending a file because file captions are not supported',async()=>{
 invoke.mockResolvedValueOnce({data:{path:'owner/request/recibo.pdf',token:'signed-upload'}}).mockResolvedValueOnce({data:{sendStatus:'sent'}});uploadToSignedUrl.mockResolvedValue({error:null});
 render(<MessageComposer conversationId="conversation-caption" onSent={()=>{}}/>);const file=new File(['pdf'],'recibo.pdf',{type:'application/pdf'});
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[file]}});fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Segue o recibo'}});fireEvent.keyDown(screen.getByLabelText('Mensagem'),{key:'Enter',code:'Enter'});
 await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));expect((screen.getByLabelText('Mensagem') as HTMLTextAreaElement).value).toBe('Segue o recibo');
});
it('ponte que recusa é falha certa: não vira "confirmação demorou" nem fica pendente',async()=>{
 const recusa=Object.assign(new Error('http'),{context:{json:async()=>({error:'bridge_rejected'})}});
 invoke.mockResolvedValue({data:null,error:recusa});
 render(<MessageComposer conversationId="conversation-recusa" onSent={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Oi'}});
 fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 expect(await screen.findByText(/Não foi enviado/)).not.toBeNull();
 // Como não saiu, o compositor não pode exigir "Verificar envio" antes de escrever.
 expect(screen.queryByRole('button',{name:'Verificar envio'})).toBeNull();
});
it('offers a retry instead of a reload when the browser blocks the microphone',async()=>{
 const getUserMedia=vi.fn().mockRejectedValue(new DOMException('denied','NotAllowedError'));
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
 vi.stubGlobal('MediaRecorder',class FakeMediaRecorder{static isTypeSupported(){return true}});
 render(<MessageComposer conversationId="conversation-audio" onSent={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Gravar áudio'}));
 expect(await screen.findByText(/bloqueou o microfone/i)).not.toBeNull();
 // Liberar a permissão no navegador não pode custar um recarregamento.
 fireEvent.click(screen.getByRole('button',{name:'Tentar de novo'}));
 await waitFor(()=>expect(getUserMedia).toHaveBeenCalledTimes(2));
});
it('aponta o endereço, e não o microfone, quando a página não é segura',async()=>{
 vi.stubGlobal('isSecureContext',false);
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn()}});
 vi.stubGlobal('MediaRecorder',class FakeMediaRecorder{static isTypeSupported(){return true}});
 render(<MessageComposer conversationId="conversation-http" onSent={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Gravar áudio'}));
 expect(await screen.findByText(/endereço seguro \(https\)/i)).not.toBeNull();
});
