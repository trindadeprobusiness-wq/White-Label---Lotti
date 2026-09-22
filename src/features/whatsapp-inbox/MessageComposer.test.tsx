// @vitest-environment jsdom
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MessageComposer} from './MessageComposer';
const {invoke,uploadToSignedUrl}=vi.hoisted(()=>({invoke:vi.fn(),uploadToSignedUrl:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke},storage:{from:()=>({uploadToSignedUrl})}}}));
afterEach(()=>{cleanup();vi.resetAllMocks()});
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
