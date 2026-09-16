import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import LiveAgentInbox from './LiveAgentInbox';
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:vi.fn()}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'owner'}})}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:vi.fn()}),useMutation:()=>({mutate:vi.fn()}),useQuery:({queryKey}:{queryKey:string[]})=>({isSuccess:true,data:queryKey[0]==='lotti-agent-conversations'?[{id:'conversation',phone:'0000000000',mode:'human',qualification:{}}]:queryKey[0]==='whatsapp-connection'?{state:'connected'}:[]})}));
it('renders the real composer for a received conversation',()=>{
 const html=renderToStaticMarkup(<MemoryRouter><LiveAgentInbox/></MemoryRouter>);
 expect(html).toContain('aria-label="Mensagem"');expect(html).toContain('Gravar áudio');expect(html).toContain('Enviar');
});
