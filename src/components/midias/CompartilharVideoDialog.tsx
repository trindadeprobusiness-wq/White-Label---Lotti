import { useState, useEffect } from 'react';
import { Share2, Copy, Clock, Check, MessageCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { VideoRow } from '@/hooks/useVideos';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { useCRMStore } from '@/stores/crmStore';
import { toast } from 'sonner';
import { format, addDays, addHours } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface CompartilharVideoDialogProps {
  video: VideoRow | null;
  imovelNome?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getTemporaryShareUrl: (videoPath: string, expiresIn: number) => Promise<string>;
}

interface CorretorInfo {
  nome: string;
  telefone: string;
  creci: string;
  creci_estado: string;
}

const DURATION_OPTIONS = [
  { value: '86400', label: '1 dia', seconds: 86400 },
  { value: '259200', label: '3 dias', seconds: 259200 },
  { value: '604800', label: '7 dias', seconds: 604800 },
  { value: '2592000', label: '30 dias', seconds: 2592000 },
];

export function CompartilharVideoDialog({
  video,
  imovelNome,
  open,
  onOpenChange,
  getTemporaryShareUrl,
}: CompartilharVideoDialogProps) {
  const [duration, setDuration] = useState('604800');
  const [customMessage, setCustomMessage] = useState('');
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [corretor, setCorretor] = useState<CorretorInfo | null>(null);

  // Fetch corretor info
  useEffect(() => {
    const fetchCorretor = async () => {
      if (apiDisponivel()) {
        // Login próprio, sem sessão do Supabase: a assinatura vem do perfil já
        // carregado no crmStore (busca uma vez se ainda não chegou).
        const store = useCRMStore.getState();
        if (!store.corretor) await store.fetchCorretor();
        const c = useCRMStore.getState().corretor;
        if (c) setCorretor({ nome: c.nome, telefone: c.telefone, creci: c.creci, creci_estado: c.creci_estado });
        return;
      }
      const { data: corretorId } = await supabase.rpc('get_corretor_id');
      if (corretorId) {
        const { data } = await supabase
          .from('corretores')
          .select('nome, telefone, creci, creci_estado')
          .eq('id', corretorId)
          .single();
        if (data) setCorretor(data);
      }
    };
    if (open) fetchCorretor();
  }, [open]);

  // Generate default message
  useEffect(() => {
    if (video && corretor) {
      const imovelInfo = imovelNome ? `\n📍 *${imovelNome}*` : '';
      const defaultMessage = `Olá! 👋

Confira este vídeo exclusivo que separei para você:

🎬 *${video.titulo}*${imovelInfo}

Qualquer dúvida, estou à disposição!

*${corretor.nome}*
📞 ${corretor.telefone}
CRECI: ${corretor.creci}/${corretor.creci_estado}`;
      setCustomMessage(defaultMessage);
    }
  }, [video, corretor, imovelNome]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setGeneratedUrl(null);
      setCopied(false);
      setDuration('604800');
    }
  }, [open]);

  const getExpirationDate = () => {
    const seconds = parseInt(duration);
    if (seconds < 86400) {
      return format(addHours(new Date(), seconds / 3600), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    }
    return format(addDays(new Date(), seconds / 86400), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  };

  const generateShareUrl = async () => {
    if (!video) return;
    
    setLoading(true);
    try {
      const url = await getTemporaryShareUrl(video.video_path, parseInt(duration));
      setGeneratedUrl(url);
    } catch (error) {
      // Error already handled in hook
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!generatedUrl) return;
    
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      toast.success('Link copiado!');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error('Erro ao copiar link');
    }
  };

  const shareViaWhatsApp = () => {
    if (!generatedUrl) return;
    
    const durationLabel = DURATION_OPTIONS.find(d => d.value === duration)?.label || '7 dias';
    const fullMessage = `${customMessage}\n\n🎬 ${generatedUrl}\n\n⏰ _Link válido por ${durationLabel}_`;
    const encodedMessage = encodeURIComponent(fullMessage);
    window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
    toast.success('Abrindo WhatsApp...');
  };

  if (!video) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            Compartilhar Vídeo
          </DialogTitle>
          <DialogDescription>
            Gere um link temporário seguro para compartilhar via WhatsApp
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Video Info */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="font-medium text-sm">{video.titulo}</p>
            {imovelNome && (
              <p className="text-xs text-muted-foreground mt-1">📍 {imovelNome}</p>
            )}
          </div>

          {/* Duration Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Validade do Link
            </Label>
            <RadioGroup
              value={duration}
              onValueChange={setDuration}
              className="flex flex-wrap gap-2"
            >
              {DURATION_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center">
                  <RadioGroupItem
                    value={option.value}
                    id={`duration-${option.value}`}
                    className="sr-only"
                  />
                  <Label
                    htmlFor={`duration-${option.value}`}
                    className={`px-3 py-1.5 rounded-full text-sm cursor-pointer transition-colors ${
                      duration === option.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Custom Message */}
          <div className="space-y-2">
            <Label>Mensagem Personalizada</Label>
            <Textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={6}
              className="text-sm resize-none"
              placeholder="Digite sua mensagem..."
            />
          </div>

          {/* Expiration Info */}
          <Badge variant="outline" className="w-full justify-center py-1.5">
            <Clock className="h-3 w-3 mr-2" />
            Link válido até: {getExpirationDate()}
          </Badge>

          {/* Actions */}
          {!generatedUrl ? (
            <Button
              onClick={generateShareUrl}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Gerando link...
                </>
              ) : (
                <>
                  <Share2 className="h-4 w-4 mr-2" />
                  Gerar Link de Compartilhamento
                </>
              )}
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={copyLink}>
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2 text-green-600" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar Link
                  </>
                )}
              </Button>
              <Button onClick={shareViaWhatsApp} className="bg-green-600 hover:bg-green-700">
                <MessageCircle className="h-4 w-4 mr-2" />
                WhatsApp
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
