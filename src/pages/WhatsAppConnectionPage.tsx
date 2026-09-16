import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export default function WhatsAppConnectionPage() {
  const [company, setCompany] = useState('Lotti Imóveis');
  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-6">
      <div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</p>
          <h1 className="mt-2 text-2xl font-semibold">Conexão</h1>
          <p className="mt-1 text-sm text-muted-foreground">Conecte o número WhatsApp Business da imobiliária para enviar e receber mensagens.</p>
        </div>
      </div>

      <div data-testid="connection-panels" className="space-y-4">
      <section aria-label="Status da conexão com WhatsApp" className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Status</h2>
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Conectado</Badge>
        </div>
        <div data-testid="status-details" className="mt-5 space-y-4 text-sm">
          <p><strong>Número:</strong> +55 62 98440-0709</p>
          <label htmlFor="company" className="block max-w-xl font-semibold">Empresa
            <Input id="company" value={company} onChange={event => setCompany(event.target.value)} className="mt-2 font-normal" placeholder="Nome da empresa onde você trabalha" />
          </label>
          <p className="text-sm text-muted-foreground">Conectado hoje, às 10:00</p>
        </div>
        <Button type="button" variant="outline" className="mt-4 border-destructive text-destructive hover:bg-destructive/5 hover:text-destructive">Desconectar</Button>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Teste de envio</h2>
        <p className="mt-3 text-sm leading-5 text-muted-foreground">Envia uma mensagem simples para confirmar que a integração está ativa. O telefone de destino precisa estar autorizado no painel da Meta.</p>
        <label htmlFor="test-phone" className="mt-4 block text-sm font-medium">Número que receberá o teste</label>
        <p className="mt-1 text-xs text-muted-foreground">Digite o WhatsApp com DDD. Exemplo: (62) 99999-9999.</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input id="test-phone" placeholder="(62) 99999-9999" inputMode="tel" />
          <Button type="button" className="sm:min-w-52">Enviar “Olá, tudo bem?”</Button>
        </div>
      </section>
      </div>
    </div>
  );
}
