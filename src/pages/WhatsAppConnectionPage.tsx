import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { WhatsAppConnection } from '@/features/whatsapp-inbox/WhatsAppConnection';
import { Button } from '@/components/ui/button';

export default function WhatsAppConnectionPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</p>
          <h1 className="mt-2 text-2xl font-semibold">Conexão</h1>
          <p className="mt-1 text-sm text-muted-foreground">Conecte o número de atendimento para enviar e receber mensagens no Inbox da Lotti.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/whatsapp"><MessageCircle className="mr-2 h-4 w-4" />Abrir Inbox<ArrowRight className="ml-2 h-4 w-4" /></Link>
        </Button>
      </div>
      <WhatsAppConnection />
    </div>
  );
}
