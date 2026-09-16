import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import WhatsAppInboxPage from '@/pages/WhatsAppInbox';
import { WhatsAppConnection } from './WhatsAppConnection';
import { useWhatsAppConnectionQuery } from './useWhatsAppConnection';

export default function LiveAgentInbox() {
  const { user } = useAuth();
  const { search } = useLocation();
  const previewMode = new URLSearchParams(search).get('preview');
  const preview = import.meta.env.DEV && previewMode !== 'disconnected';
  const connection = useWhatsAppConnectionQuery(user?.id);
  const connected = preview || (connection.data?.state === 'connected' && !connection.isError);

  if (connected) return <WhatsAppInboxPage />;

  return <div className="mx-auto max-w-4xl space-y-6 pb-16">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</p>
      <h1 className="mt-2 text-2xl font-semibold">Conecte seu WhatsApp</h1>
      <p className="mt-1 text-sm text-muted-foreground">Leia o QR Code para liberar o Inbox e receber as conversas nesta conta.</p>
    </div>
    <WhatsAppConnection />
  </div>;
}
