// @vitest-environment jsdom
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MessageComposer} from './MessageComposer';
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke}}}));
afterEach(()=>{cleanup();vi.resetAllMocks()});
it('sends text from the selected conversation and clears only after confirmation',async()=>{
 invoke.mockResolvedValue({data:{sendStatus:'sent'}});const sent=vi.fn();render(<MessageComposer conversationId="conversation-a" onSent={sent}/>);
 fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Olá, podemos agendar?'}});fireEvent.click(screen.getByText('Enviar'));
 await waitFor(()=>expect(sent).toHaveBeenCalledOnce());expect(invoke.mock.calls[0][1].body.conversation_id).toBe('conversation-a');expect((screen.getByLabelText('Mensagem') as HTMLTextAreaElement).value).toBe('');
});
it('reuses the same request after timeout rather than sending a duplicate',async()=>{
 invoke.mockResolvedValueOnce({error:new Error('timeout')}).mockResolvedValueOnce({data:{sendStatus:'sent'}});
 render(<MessageComposer conversationId="conversation-b" onSent={()=>{}}/>);fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Teste'}});fireEvent.click(screen.getByText('Enviar'));
 await screen.findByText('Verificar envio');fireEvent.click(screen.getByText('Verificar envio'));await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));expect(invoke.mock.calls[0][1].body.request_id).toBe(invoke.mock.calls[1][1].body.request_id);
});
