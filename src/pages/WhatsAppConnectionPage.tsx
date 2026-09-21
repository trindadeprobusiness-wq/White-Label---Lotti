import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useWhatsAppConnectionQuery, type WhatsAppConnectionState } from '@/features/whatsapp-inbox/useWhatsAppConnection';
import { WhatsAppConnection } from '@/features/whatsapp-inbox/WhatsAppConnection';

export default function WhatsAppConnectionPage() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const connection = useWhatsAppConnectionQuery(user?.id);
  const [company, setCompany] = useState('Lotti Imóveis');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const disconnect = useMutation({
    mutationFn: async () => {
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
  const state = connection.data?.state;
  const connected = state === 'connected' && !connection.isError;
  return <div data-testid="connection-page" className="mx-auto -mb-16 max-w-4xl space-y-4 pb-0">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</p>
      <h1 className="mt-2 text-2xl font-semibold">Conexão</h1>
      <p className="mt-1 text-sm text-muted-foreground">Acompanhe o número de atendimento conectado ao Inbox da imobiliária.</p></div>
    <div data-testid="connection-panels" className="space-y-4">
      <section aria-label="Status da conexão com WhatsApp" className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3"><h2 className="text-xl font-semibold">Status</h2>
          <Badge className={connected ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50' : 'border-border bg-muted text-foreground hover:bg-muted'}>
            {connection.isPending ? 'Consultando' : connection.isError ? 'Indisponível' : connected ? 'Conectado' : state === 'connecting' ? 'Conectando' : 'Desconectado'}
          </Badge></div>
        <div data-testid="status-details" className="mt-5 space-y-4 text-sm">
          <label htmlFor="company" className="block max-w-xl font-semibold">Empresa
            <Input id="company" value={company} onChange={event => setCompany(event.target.value)} className="mt-2 font-normal" placeholder="Nome da empresa onde você trabalha" /></label>
          {connected ? <p className="text-muted-foreground">Número conectado. As mensagens novas aparecem no Inbox após serem recebidas.</p>
            : <p className="text-muted-foreground">{connection.isError ? 'Não foi possível consultar o WhatsApp agora. O estado anterior não foi confirmado.' : state === 'connecting' ? 'Aguardando a confirmação do WhatsApp no celular.' : 'Nenhum dispositivo conectado no momento.'}</p>}
        </div>
        {connection.isError && <Button variant="outline" className="mt-4" onClick={() => void connection.refetch()}>Tentar novamente</Button>}
        {connected && <Button type="button" variant="outline" className="mt-4 border-destructive text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>}
        {disconnect.isError && <p role="alert" className="mt-3 text-sm text-destructive">Não foi possível desconectar. Verifique o estado da conexão e tente novamente.</p>}
      </section>
      {!connected && <WhatsAppConnection />}
      <section className="rounded-xl border bg-card p-5 shadow-sm"><h2 className="text-xl font-semibold">Teste de recebimento</h2>
        <p className="mt-3 text-sm leading-5 text-muted-foreground">Depois que o status estiver conectado, envie uma mensagem de um contato de teste para o número da empresa. Conversas antigas não são importadas automaticamente; grupos e status não entram no Inbox.</p></section>
    </div>
    <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Desconectar este WhatsApp?</AlertDialogTitle>
        <AlertDialogDescription>O dispositivo será removido da conexão. Novas mensagens deixarão de chegar ao Inbox até que você escaneie outro QR code. As conversas já registradas no app permanecem.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={disconnect.isPending}>Cancelar</AlertDialogCancel>
        <AlertDialogAction disabled={disconnect.isPending} onClick={event => { event.preventDefault(); disconnect.mutate(); }}>{disconnect.isPending ? 'Desconectando…' : 'Desconectar'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}
