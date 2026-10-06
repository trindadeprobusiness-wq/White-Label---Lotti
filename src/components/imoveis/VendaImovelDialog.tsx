import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCRMStore } from '@/stores/crmStore';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { apiDisponivel } from '@/lib/api';
import { registrarEventoVendaApi, registrarVendaImovelApi } from '@/lib/api/imoveis';

interface VendaImovelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imovel: any;
  onSuccess?: () => void;
}

export function VendaImovelDialog({ open, onOpenChange, imovel, onSuccess }: VendaImovelDialogProps) {
  const { clientes, fetchImoveis } = useCRMStore();
  const { toast } = useToast();
  
  const [selectedClienteId, setSelectedClienteId] = useState<string>('none');
  const [valorVenda, setValorVenda] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open && imovel) {
      setValorVenda(imovel.valor?.toString() || '');
      setSelectedClienteId('none');
    }
  }, [open, imovel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !imovel) return;

    setIsSubmitting(true);

    try {
      let cliente: any = null;
      if (apiDisponivel()) {
        // Passos 1 e 2 numa chamada: o imóvel é confirmado antes do cliente, e a
        // falha do cliente não desfaz a venda (cliente_atualizado não é lido, como hoje).
        await registrarVendaImovelApi(imovel.id, selectedClienteId !== 'none' ? selectedClienteId : null);
        if (selectedClienteId !== 'none') cliente = clientes.find(c => c.id === selectedClienteId);
      } else {
        // 1. Marcar imóvel como VENDIDO
        const { error: imovelError } = await supabase
          .from('imoveis')
          .update({ status_venda: 'VENDIDO' } as any)
          .eq('id', imovel.id);

        if (imovelError) throw imovelError;

        // 2. Coletar dados do comprador se selecionado
        if (selectedClienteId !== 'none') {
          cliente = clientes.find(c => c.id === selectedClienteId);
          // Atualizar status do cliente para FECHADO_GANHO
          await supabase
            .from('clientes')
            .update({ status_funil: 'FECHADO_GANHO' })
            .eq('id', selectedClienteId);
        }
      }

      // 3. Montar o Payload do UTMify Outbox
      const baseValue = Number(valorVenda) || imovel.valor || 0;
      
      const utmPayload = {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: `venda_${imovel.id}_${Date.now()}`,
        value: baseValue,
        currency: "BRL",
        customer: {
          first_name: cliente?.nome?.split(' ')[0] || "Comprador",
          last_name: cliente?.nome?.split(' ').slice(1).join(' ') || "Desconhecido",
          email: cliente?.email || "",
          phone: cliente?.telefone?.replace(/\D/g, '') || ""
        },
        tracking: cliente?.tracking_data || imovel?.tracking_data || {},
        metadata: {
          imovel_id: imovel.id,
          imovel_titulo: imovel.titulo,
          corretor_id: imovel.corretor_id
        }
      };

      // 4. Inserir no Webhook Logs para fila garantida
      let eventoEnfileirado = true;
      if (apiDisponivel()) {
        // O servidor monta o mesmo payload com os dados do banco e grava na fila
        // (webhook_logs não tem policy para o usuário: pelo Supabase o insert sempre falhava).
        try {
          await registrarEventoVendaApi(imovel.id, {
            valor: baseValue,
            cliente_id: selectedClienteId !== 'none' ? selectedClienteId : null,
          });
        } catch (logError) {
          console.error("Erro ao enfileirar o evento de conversão:", logError);
          eventoEnfileirado = false; // a venda já foi gravada: não cancela, mas avisa
        }
      } else {
        const { error: logError } = await (supabase as any)
          .from('webhook_logs')
          .insert({
            event_type: 'SALE_PURCHASE',
            payload: utmPayload,
            status: 'PENDING',
            // O URL de endpoint real deverá ser configurado ou inserido aqui.
            // Estamos colocando um genérico para ser capturado pela Edge Function futuramente ou processado client-side
            endpoint_url: 'UTMIFY_DEFAULT_ENDPOINT'
          });

        if (logError) {
          console.error("Erro ao inserir log:", logError);
          // Não jogamos throw para não cancelar a venda visual
        }
      }

      // Agora acionamos via Fetch do frontend também, para garantir processamento rápido no UTMIFY caso a Edge function não esteja ativa
      // Puxando o endpoint do .env local se existir
      const webhookUrl = import.meta.env.VITE_UTMIFY_WEBHOOK_URL;
      if (webhookUrl) {
          fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(utmPayload)
          }).catch(console.error);
      }

      toast({
        title: 'Venda registrada com sucesso!',
        description: eventoEnfileirado
          ? 'O evento de conversão foi enfileirado no sistema.'
          : 'Mas o evento de conversão não pôde ser enfileirado.',
      });
      
      await fetchImoveis();
      if (onSuccess) onSuccess();
      onOpenChange(false);
      
    } catch (error: any) {
      console.error("Erro ao registrar venda:", error);
      toast({ variant: 'destructive', title: 'Erro ao registrar venda', description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sinalizar Imóvel VENDIDO</DialogTitle>
          <DialogDescription>
            Isao atualizará o status do imóvel e enviará os dados de conversão para o UTMify/Tracking.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Valor da Venda Final (R$)</Label>
            <Input 
              type="number" 
              required 
              value={valorVenda}
              onChange={(e) => setValorVenda(e.target.value)}
              placeholder="Ex: 500000"
            />
          </div>

          <div>
            <Label>Cliente / Comprador</Label>
            <Select value={selectedClienteId} onValueChange={setSelectedClienteId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione quem comprou" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não cadastrado / Cliente externo</SelectItem>
                {clientes.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} {c.telefone && `- ${c.telefone}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Selecionar o cliente ajuda a sincronizar os dados avançados (e-mail, fbclid) com o Meta Ads para atribuição de vendas.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting} className="bg-green-600 hover:bg-green-700">
              {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Confirmar Venda
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
