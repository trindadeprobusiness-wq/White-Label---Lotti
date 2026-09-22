import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import ConnectedInbox from './ConnectedInbox';
import WhatsAppInboxPage from '@/pages/WhatsAppInbox';
import { useWhatsAppConnectionQuery } from './useWhatsAppConnection';
import { WhatsAppConnection } from './WhatsAppConnection';

export default function LiveAgentInbox() {
  const { user } = useAuth();
  const { search } = useLocation();
  const previewMode = new URLSearchParams(search).get('preview');
  const preview = import.meta.env.DEV && previewMode === 'connected';
  const pairingPreview = import.meta.env.DEV && previewMode === 'pairing';
  const connection = useWhatsAppConnectionQuery(user?.id);
  const connected = !connection.isPending && !connection.isError && connection.data?.state === 'connected';

  if (preview) return <WhatsAppInboxPage />;

  if (pairingPreview) return <div className="mx-auto max-w-3xl animate-fade-in"><WhatsAppConnection previewPairing /></div>;

  if (!connected) return <div className="mx-auto max-w-3xl animate-fade-in"><WhatsAppConnection autoStart /></div>;

  return <div className="-mx-5 -mb-16 -mt-20 animate-fade-in md:-mx-8 md:-mt-8"><ConnectedInbox connected /></div>;
}
