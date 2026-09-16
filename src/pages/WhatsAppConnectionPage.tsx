import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export default function WhatsAppConnectionPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</p>
          <h1 className="mt-2 text-2xl font-semibold">Conexão</h1>
          <p className="mt-1 text-sm text-muted-foreground">Conecte o número WhatsApp Business da imobiliária para enviar e receber mensagens.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/whatsapp?preview=connected"><MessageCircle className="mr-2 h-4 w-4" />Abrir Inbox<ArrowRight className="ml-2 h-4 w-4" /></Link>
        </Button>
      </div>

      <section aria-label="Status da conexão com WhatsApp" className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold">Status</h2>
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Conectado</Badge>
        </div>
        <div className="mt-7 space-y-5 text-base">
          <p><strong>Número:</strong> +55 62 98440-0709</p>
          <p><strong>Empresa:</strong> Lotti Imóveis</p>
          <p className="text-sm text-muted-foreground"><strong>WABA ID:</strong> 000000000000000 · <strong>Phone ID:</strong> 000000000000000</p>
          <p className="text-sm text-muted-foreground">Conectado hoje, às 10:00</p>
        </div>
        <Button type="button" variant="outline" className="mt-5 border-destructive text-destructive hover:bg-destructive/5 hover:text-destructive">Desconectar</Button>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">Teste de envio</h2>
        <p className="mt-5 leading-6 text-muted-foreground">Dispara o template <code>hello_world</code> para confirmar que a integração está ativa. O telefone de destino precisa estar autorizado no painel da Meta.</p>
        <label htmlFor="test-phone" className="mt-5 block text-sm font-medium">Telefone (E.164 sem +)</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <Input id="test-phone" defaultValue="5562999999999" inputMode="numeric" />
          <Button type="button" className="sm:min-w-52">Enviar hello_world</Button>
        </div>
      </section>
    </div>
  );
}
