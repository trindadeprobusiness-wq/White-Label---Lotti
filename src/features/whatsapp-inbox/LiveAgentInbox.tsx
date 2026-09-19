import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import ConnectedInbox from './ConnectedInbox';
import WhatsAppInboxPage from '@/pages/WhatsAppInbox';
import { WhatsAppConnection } from './WhatsAppConnection';
import { useWhatsAppConnectionQuery } from './useWhatsAppConnection';

export default function LiveAgentInbox() {
  const { user } = useAuth();
  const { search } = useLocation();
  const previewMode = new URLSearchParams(search).get('preview');
  const preview = import.meta.env.DEV && previewMode === 'connected';
  const connection = useWhatsAppConnectionQuery(user?.id);
  const connected = preview || (connection.data?.state === 'connected' && !connection.isError);

  if (preview) return <WhatsAppInboxPage />;

  return <div className="space-y-4">
    {!connected && <div className="mx-auto max-w-4xl"><WhatsAppConnection /></div>}
    <ConnectedInbox connected={connected} />
  </div>;
}
