import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import ConnectedInbox from './ConnectedInbox';
import WhatsAppInboxPage from '@/pages/WhatsAppInbox';
import { useWhatsAppConnectionQuery } from './useWhatsAppConnection';

export default function LiveAgentInbox() {
  const { user } = useAuth();
  const { search } = useLocation();
  const previewMode = new URLSearchParams(search).get('preview');
  const preview = import.meta.env.DEV && previewMode === 'connected';
  const connection = useWhatsAppConnectionQuery(user?.id);
  const connected = preview || (connection.data?.state === 'connected' && !connection.isError);

  if (preview) return <WhatsAppInboxPage />;

  return <div className="-mx-5 -mb-16 -mt-20 animate-fade-in md:-mx-8 md:-mt-8"><ConnectedInbox connected={connected} /></div>;
}
