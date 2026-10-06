import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useWhatsAppConnectionQuery, type WhatsAppConnectionState } from '@/features/whatsapp-inbox/useWhatsAppConnection';
import { apiDisponivel } from '@/lib/api';
import { canalApi, empresaCanalApi, whatsappBridgeApi } from '@/lib/api/whatsapp';
import { WhatsAppConnection } from '@/features/whatsapp-inbox/WhatsAppConnection';
import { MENSAGEM_DA_PONTE } from '@/features/whatsapp-inbox/bridgeError';

export default function WhatsAppConnectionPage() {
  const { user } = useAuth();
  const { search } = useLocation();
  const connectedPreview = import.meta.env.DEV && new URLSearchParams(search).get('preview') === 'connected';
  const cache = useQueryClient();
  const connection = useWhatsAppConnectionQuery(user?.id);
  const [testPhone, setTestPhone] = useState('');
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyDraft, setCompanyDraft] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const disconnect = useMutation({
    mutationFn: async () => {
      if (apiDisponivel()) { const data=await whatsappBridgeApi<WhatsAppConnectionState>({action:'disconnect'}); if(data.state!=='disconnected')throw new Error('disconnect_failed'); return data; }
      const { data, error } = await supabase.functions.invoke<WhatsAppConnectionState>('lotti-whatsapp', { body: { action: 'disconnect' } });
      if (error || data?.state !== 'disconnected') throw error ?? new Error('disconnect_failed');
      return data;
    },
    onSuccess: data => {
      cache.setQueryData(['whatsapp-connection', user?.id], data);
      setConfirmDisconnect(false);
      void connection.refetch();
    },
  });
  const state = connectedPreview ? 'connected' : connection.data?.state;
  const connectionError = !connectedPreview && connection.isError;
  const connectionPending = !connectedPreview && connection.isPending;
  const connected = state === 'connected' && !connectionError;
  const phone = connectedPreview ? '556281149611' : connection.data?.phone;
  const company = useQuery({
    queryKey: ['whatsapp-company', user?.id, phone], enabled: !!user && connected && !!phone && !connectedPreview,
    queryFn: async () => {
      if (apiDisponivel()) return ((await canalApi<{company_name:string|null}>(phone!))?.company_name)||'Lotti Imóveis';
      const db = supabase as unknown as SupabaseClient;
      const { data, error } = await db.from('lotti_agent_channels').select('company_name').eq('account_phone', phone!).is('archived_at', null).maybeSingle();
      if (error) throw error;
      return (data?.company_name as string | null) || 'Lotti Imóveis';
    },
  });
  const companyName = connectedPreview ? 'Lotti Imóveis' : company.data || 'Lotti Imóveis';
  const saveCompany = useMutation({
    mutationFn: async () => {
      if (apiDisponivel()) { await empresaCanalApi(phone!,companyDraft.trim()); return; }
      const db = supabase as unknown as SupabaseClient;
      const { data, error } = await db.rpc('lotti_channel_set_company_name', { p_phone: phone, p_name: companyDraft.trim() });
      if (error || data !== true) throw error ?? new Error('company_update_failed');
    },
    onSuccess: () => { setEditingCompany(false); void cache.invalidateQueries({ queryKey: ['whatsapp-company', user?.id, phone] }); },
  });
  const connectedAt = connectedPreview ? '22/09/2026, 14:00' : connection.data?.connectedAt ? new Date(connection.data.connectedAt).toLocaleString('pt-BR') : null;
  const formatPhone = (value?: string) => {
    if (!value) return 'Número não informado';
    const digits = value.replace(/\D/g, '');
    if (digits.length === 12) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
    if (digits.length === 13) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    return `+${digits}`;
  };
  const testingOwnNumber = !!phone && testPhone.replace(/\D/g, '') === phone.replace(/\D/g, '');
  const testSend = useMutation({
    mutationFn: async () => {
      if (apiDisponivel()) { const data=await whatsappBridgeApi<{sendStatus?:string}>({action:'start',phone:testPhone,text:'Olá, tudo bem?',request_id:crypto.randomUUID()}); if(data.sendStatus!=='sent')throw new Error(data.sendStatus==='sending'||data.sendStatus==='uncertain'?'send_unconfirmed':'send_failed');return data; }
      const { data, error } = await supabase.functions.invoke<{ sendStatus?: string }>('lotti-whatsapp', { body: {
        action: 'start', phone: testPhone, text: 'Olá, tudo bem?', request_id: crypto.randomUUID(),
      } });
      if (error || !data) throw error ?? new Error('send_unavailable');
      if (data.sendStatus !== 'sent') throw new Error(data.sendStatus === 'sending' || data.sendStatus === 'uncertain' ? 'send_unconfirmed' : 'send_failed');
      return data;
    },
  });
  return <div data-testid="connection-page" className="mx-auto -mb-16 max-w-4xl space-y-4 pb-0">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</p>
      <h1 className="mt-2 text-2xl font-semibold">Conexão</h1>
      <p className="mt-1 text-sm text-muted-foreground">Acompanhe o número de atendimento conectado ao Inbox da imobiliária.</p></div>
    <div data-testid="connection-panels" className="space-y-4">
      <section aria-label="Status da conexão com WhatsApp" className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3"><h2 className="text-xl font-semibold">Status</h2>
          <Badge className={connected ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50' : 'border-border bg-muted text-foreground hover:bg-muted'}>
            {connectionPending ? 'Consultando' : connectionError ? 'Indisponível' : connected ? 'Conectado' : state === 'connecting' ? 'Conectando' : 'Desconectado'}
          </Badge></div>
        <div data-testid="status-details" className="mt-5 space-y-4 text-sm">
          {connected && <><p><strong>Número:</strong> {formatPhone(phone)}</p><div><strong>Empresa:</strong> {editingCompany ? <div className="mt-2 flex max-w-md gap-2"><label className="sr-only" htmlFor="company-name">Nome da empresa</label><Input id="company-name" value={companyDraft} maxLength={80} onChange={event => setCompanyDraft(event.target.value)} /><Button type="button" disabled={!companyDraft.trim() || saveCompany.isPending} onClick={() => saveCompany.mutate()}>Salvar empresa</Button><Button type="button" variant="outline" onClick={() => setEditingCompany(false)}>Cancelar</Button></div> : <>{companyName} <Button type="button" variant="ghost" size="sm" onClick={() => { setCompanyDraft(companyName); setEditingCompany(true); }}>Editar empresa</Button></>}</div>{saveCompany.isError && <p role="alert" className="text-destructive">Não foi possível salvar a empresa.</p>}{connectedAt&&<p className="text-muted-foreground"><strong>Conectado em:</strong> {connectedAt}</p>}</>}
          {connected ? <p className="text-muted-foreground">As mensagens novas aparecem no Inbox após serem recebidas.</p>
            : <p className="text-muted-foreground">{connectionError ? (MENSAGEM_DA_PONTE[(connection.error as { codigo?: string } | null)?.codigo ?? ''] ?? 'Não foi possível consultar o WhatsApp agora. O estado anterior não foi confirmado.') : state === 'connecting' ? 'Aguardando a confirmação do WhatsApp no celular.' : 'Nenhum dispositivo conectado no momento.'}</p>}
        </div>
        {connectionError && <Button variant="outline" className="mt-4" onClick={() => void connection.refetch()}>Tentar novamente</Button>}
        {connected && <Button type="button" variant="outline" className="mt-4 border-destructive text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>}
        {disconnect.isError && <p role="alert" className="mt-3 text-sm text-destructive">Não foi possível desconectar. Verifique o estado da conexão e tente novamente.</p>}
      </section>
      {!connectionPending && !connectionError && !connected && <WhatsAppConnection autoStart />}
      <section className="rounded-xl border bg-card p-5 shadow-sm"><h2 className="text-xl font-semibold">Teste de envio</h2>
        <p className="mt-3 text-sm leading-5 text-muted-foreground">Informe outro telefone que possa receber a mensagem “Olá, tudo bem?” para testar a integração.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row"><label htmlFor="test-phone" className="sr-only">Telefone para teste</label><Input id="test-phone" aria-label="Telefone para teste" value={testPhone} onChange={event => setTestPhone(event.target.value)} placeholder="5562999999999" disabled={!connected || testSend.isPending} />
          <Button type="button" disabled={!connected || !testPhone.trim() || testingOwnNumber || testSend.isPending} onClick={() => testSend.mutate()}>{testSend.isPending ? 'Enviando…' : 'Enviar “Olá, tudo bem?”'}</Button></div>
        {testingOwnNumber && <p className="mt-2 text-sm text-muted-foreground">Use outro número para o teste, diferente do WhatsApp conectado.</p>}
        {testSend.isSuccess && <p className="mt-3 text-sm text-emerald-700">Mensagem de teste enviada.</p>}
        {testSend.isError && <p role="alert" className="mt-3 text-sm text-destructive">{testSend.error instanceof Error && testSend.error.message === 'send_unconfirmed' ? 'O envio ainda não foi confirmado. Confira no WhatsApp antes de tentar novamente.' : 'Não foi possível enviar a mensagem de teste. Verifique a conexão e tente com outro número.'}</p>}
      </section>
    </div>
    <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Desconectar este WhatsApp?</AlertDialogTitle>
        <AlertDialogDescription>O dispositivo será removido da conexão. Novas mensagens deixarão de chegar ao Inbox até que você escaneie outro QR code. As conversas já registradas no app permanecem.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={disconnect.isPending}>Cancelar</AlertDialogCancel>
        <AlertDialogAction disabled={disconnect.isPending} onClick={event => { event.preventDefault(); disconnect.mutate(); }}>{disconnect.isPending ? 'Desconectando…' : 'Desconectar'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}
