import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function WhatsAppConnectionPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</p>
          <h1 className="mt-2 text-2xl font-semibold">Conexão</h1>
          <p className="mt-1 text-sm text-muted-foreground">Acompanhe o canal usado para enviar e receber mensagens no Inbox da Lotti.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/whatsapp"><MessageCircle className="mr-2 h-4 w-4" />Abrir Inbox<ArrowRight className="ml-2 h-4 w-4" /></Link>
        </Button>
      </div>
      <section aria-label="Status da conexão com WhatsApp" className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b pb-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <div className="mr-auto">
            <p className="text-sm text-muted-foreground">Status</p>
            <h2 className="text-lg font-semibold">WhatsApp conectado</h2>
          </div>
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Conectado</Badge>
        </div>
        <dl className="grid gap-5 pt-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Canal</dt>
            <dd className="mt-1 font-medium">WhatsApp Business</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Atendimento</dt>
            <dd className="mt-1 font-medium">Inbox ativo</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Recebimento de mensagens</dt>
            <dd className="mt-1 font-medium">Ativado</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Agente Lotti</dt>
            <dd className="mt-1 font-medium">Disponível</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
