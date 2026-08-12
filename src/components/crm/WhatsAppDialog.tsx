import { useState } from 'react';
import { MessageCircle, Sparkles, Loader2, Send, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { normalizarTelefoneBR } from '@/lib/telefone';
import { mensagemDeErro } from '@/lib/errors';
import { useRegistrarContatoWhatsApp } from '@/hooks/crm/useCrm';

interface WhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contato: { id: string; nome: string; telefone?: string | null } | null;
}

const TIPOS = [
  { valor: 'custom', rotulo: 'Livre' },
  { valor: 'reminder', rotulo: 'Lembrete de follow-up' },
  { valor: 'thank_you', rotulo: 'Agradecimento' },
  { valor: 'late', rotulo: 'Cobrança / atraso' },
];

const TONS = [
  { valor: 'friendly', rotulo: 'Amigável' },
  { valor: 'formal', rotulo: 'Formal' },
  { valor: 'stern', rotulo: 'Firme' },
];

/**
 * WhatsApp do contato — o que dá para entregar hoje, de verdade.
 *
 * Não há pareamento por QR: a Evolution API do projeto aponta para localhost e
 * não existe tabela de instância nem função que fale com ela. Prometer "conectar
 * o WhatsApp" seria mentira.
 *
 * O que isto faz e é real: a IA (Edge Function `generate-whatsapp-message`, já
 * publicada) escreve o rascunho, o corretor edita, e o link abre a conversa JÁ
 * NO NÚMERO do contato com o texto pronto. O único código que existia para isso
 * era órfão e abria o WhatsApp sem destinatário — obrigando a escolher o contato
 * na mão. Além disso, a interação fica registrada no histórico do cliente.
 */
export function WhatsAppDialog({ open, onOpenChange, contato }: WhatsAppDialogProps) {
  const [tipo, setTipo] = useState('custom');
  const [tom, setTom] = useState('friendly');
  const [detalhes, setDetalhes] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [gerando, setGerando] = useState(false);
  const registrar = useRegistrarContatoWhatsApp();

  const { digitos } = normalizarTelefoneBR(contato?.telefone);

  const gerar = async () => {
    if (!contato) return;
    setGerando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sua sessão expirou. Entre novamente.');

      const { data, error } = await supabase.functions.invoke('generate-whatsapp-message', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { clientName: contato.nome, messageType: tipo, details: detalhes, tone: tom },
      });
      if (error) {
        let msg = error.message;
        try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      setMensagem(data?.message ?? '');
    } catch (err) {
      toast.error(mensagemDeErro(err, 'Não foi possível gerar a mensagem.'));
    } finally {
      setGerando(false);
    }
  };

  const abrirWhatsApp = () => {
    if (!mensagem.trim() || !contato) return;
    // Com o número: o WhatsApp abre direto na conversa certa. O código antigo
    // usava wa.me/?text= sem destinatário e caía no seletor de contatos.
    const url = digitos
      ? `https://wa.me/55${digitos}?text=${encodeURIComponent(mensagem)}`
      : `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
    window.open(url, '_blank', 'noopener,noreferrer');

    // O envio acontece fora do sistema (o corretor aperta enviar no WhatsApp),
    // então registramos como "enviado pelo corretor" e não como entrega confirmada.
    registrar.mutate({ clienteId: contato.id, mensagem });
    if (!digitos) {
      toast.warning('Este contato não tem telefone válido — o WhatsApp abriu sem destinatário.');
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-emerald-500" /> WhatsApp
          </DialogTitle>
          <DialogDescription>
            {contato?.nome}
            {digitos ? ` · ${normalizarTelefoneBR(contato?.telefone).formatado}` : ' · sem telefone válido'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Assunto</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tom</Label>
              <Select value={tom} onValueChange={setTom}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TONS.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">O que você quer dizer</Label>
            <Textarea
              value={detalhes}
              onChange={(e) => setDetalhes(e.target.value)}
              placeholder="Ex.: visita ao apartamento 302 confirmada para sábado às 10h"
              rows={2}
            />
          </div>

          <Button variant="outline" onClick={gerar} disabled={gerando} className="w-full">
            {gerando
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Escrevendo...</>
              : <><Sparkles className="h-4 w-4 mr-1.5" /> Escrever com IA</>}
          </Button>

          <div>
            <Label className="text-xs">Mensagem</Label>
            <Textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Escreva ou gere com a IA. Você pode editar antes de enviar."
              rows={6}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Nada é enviado automaticamente — o WhatsApp abre com o texto pronto e você confere antes.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => { navigator.clipboard.writeText(mensagem); toast.success('Copiado.'); }}
            disabled={!mensagem.trim()}
          >
            <Copy className="h-4 w-4 mr-1.5" /> Copiar
          </Button>
          <Button onClick={abrirWhatsApp} disabled={!mensagem.trim()}>
            <Send className="h-4 w-4 mr-1.5" /> Abrir no WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
