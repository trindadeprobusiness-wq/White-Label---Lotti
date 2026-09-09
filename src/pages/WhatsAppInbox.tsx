import { MessageCircle } from 'lucide-react';
import { PageHeader } from '@/components/shell/PageHeader';
import { WhatsAppInbox as Inbox } from '@/features/whatsapp-inbox/WhatsAppInbox';

export default function WhatsAppInbox() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        titulo="WhatsApp"
        subtitulo="Atenda seus contatos e acompanhe cada conversa em um só lugar."
        acoes={<span className="inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning-surface px-3 py-1.5 text-xs font-medium text-warning-foreground"><MessageCircle className="h-4 w-4" />Demonstração</span>}
      />
      <Inbox />
    </div>
  );
}
