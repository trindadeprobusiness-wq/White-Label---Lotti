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
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><WhatsAppConnection/></QueryClientProvider>);}
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
