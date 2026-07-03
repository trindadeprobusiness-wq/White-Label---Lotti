import { useState } from 'react';
import { Building2, MessageCircle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCRMStore } from '@/stores/crmStore';
import { useFileUpload } from '@/hooks/useFileUpload';
import {
  TIPO_NEGOCIO_LABELS,
  CTA_LABELS,
  DEFAULT_TEMPLATES,
} from '@/types/fachada';
import type { TipoNegocio, CTAPrincipal } from '@/types/fachada';

interface CriarFachadaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    imovel_id: string;
    tipo_negocio: TipoNegocio;
    template_id: string;
    cta_principal: CTAPrincipal;
    modo_conversao: boolean;
    mensagem_whatsapp?: string;
  }) => Promise<void>;
}

export function CriarFachadaDialog({
  open,
  onOpenChange,
  onSubmit,
}: CriarFachadaDialogProps) {
  const { imoveis } = useCRMStore();
  const { upload, uploading } = useFileUpload('imoveis-fotos');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Formulário
  const [imovelId, setImovelId] = useState('');
  const [tipoNegocio, setTipoNegocio] = useState<TipoNegocio>('VENDA');
  const [templateId, setTemplateId] = useState('venda-classica');
  const [customTemplateFile, setCustomTemplateFile] = useState<File | null>(null);
  const [ctaPrincipal, setCtaPrincipal] = useState<CTAPrincipal>('WHATSAPP');
  const [modoConversao, setModoConversao] = useState(false);
  const [mensagemWhatsapp, setMensagemWhatsapp] = useState('');

  const selectedImovel = imoveis.find((i) => i.id === imovelId);

  const resetForm = () => {
    setStep(1);
    setImovelId('');
    setTipoNegocio('VENDA');
    setTemplateId('venda-classica');
    setCustomTemplateFile(null);
    setCtaPrincipal('WHATSAPP');
    setModoConversao(false);
    setMensagemWhatsapp('');
  };

  const handleSubmit = async () => {
    if (!imovelId) return;
    setLoading(true);
    try {
      let finalTemplateId = templateId;

      // Upload do template customizado
      if (templateId === 'custom' && customTemplateFile) {
        const ext = customTemplateFile.name.split('.').pop();
        const fileName = `fachada-template-${Date.now()}.${ext}`;
        const result = await upload(customTemplateFile, `fachadas/${fileName}`);
        if (result?.url) {
          finalTemplateId = result.url;
        }
      }

      await onSubmit({
        imovel_id: imovelId,
        tipo_negocio: tipoNegocio,
        template_id: finalTemplateId,
        cta_principal: ctaPrincipal,
        modo_conversao: modoConversao,
        mensagem_whatsapp: mensagemWhatsapp || undefined,
      });
      resetForm();
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      alert('Erro ao criar fachada: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) resetForm();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Criar Nova Fachada
          </DialogTitle>
          <DialogDescription>
            Etapa {step} de 3 — {step === 1 ? 'Selecionar Imóvel' : step === 2 ? 'Template e Tipo' : 'CTA e Conversão'}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper visual */}
        <div className="flex gap-1 mb-4">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s <= step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Selecionar imóvel */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Imóvel *</Label>
              <Select value={imovelId} onValueChange={setImovelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um imóvel" />
                </SelectTrigger>
                <SelectContent>
                  {imoveis.map((im) => (
                    <SelectItem key={im.id} value={im.id}>
                      {im.titulo} — {im.bairro}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedImovel && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <p className="font-medium">{selectedImovel.titulo}</p>
                <p className="text-muted-foreground">
                  {selectedImovel.endereco} — {selectedImovel.bairro},{' '}
                  {selectedImovel.cidade}
                </p>
                <p className="text-primary font-bold">
                  R$ {selectedImovel.valor.toLocaleString('pt-BR')}
                </p>
              </div>
            )}

            <div>
              <Label>Tipo de Negócio</Label>
              <Select
                value={tipoNegocio}
                onValueChange={(v) => setTipoNegocio(v as TipoNegocio)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPO_NEGOCIO_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              disabled={!imovelId}
              onClick={() => setStep(2)}
            >
              Próximo
            </Button>
          </div>
        )}

        {/* Step 2: Template */}
        {step === 2 && (
          <div className="space-y-4">
            <Label>Escolha um Template</Label>
            <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
              {/* Opção Customizada */}
              <button
                onClick={() => setTemplateId('custom')}
                className={`relative rounded-xl p-4 text-center transition-all border-2 bg-muted/30 ${
                  templateId === 'custom'
                    ? 'border-primary ring-2 ring-primary/20'
                    : 'border-transparent hover:border-muted-foreground/20'
                }`}
              >
                <div className="flex flex-col items-center justify-center space-y-2">
                  <span className="text-2xl">🖼️</span>
                  <p className="text-sm font-bold">Fazer Upload</p>
                  <p className="text-[10px] opacity-60">Meu Template</p>
                </div>
                {templateId === 'custom' && (
                  <div className="absolute top-1 right-1 h-5 w-5 bg-primary rounded-full flex items-center justify-center">
                    <span className="text-white text-xs">✓</span>
                  </div>
                )}
              </button>

              {/* Templates Padrão */}
              {DEFAULT_TEMPLATES.map((t) => {
                const id = t.nome.toLowerCase().replace(/\s+/g, '-');
                const isSelected = templateId === id;
                return (
                  <button
                    key={id}
                    onClick={() => setTemplateId(id)}
                    className={`relative rounded-xl p-4 text-center transition-all border-2 ${
                      isSelected
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-transparent hover:border-muted-foreground/20'
                    }`}
                    style={{
                      background: `linear-gradient(135deg, ${t.config.corFundo}, ${t.config.corPrimaria})`,
                      color: t.config.corTexto,
                    }}
                  >
                    <p className="text-sm font-bold">{t.nome}</p>
                    <p className="text-[10px] opacity-60 mt-1">{t.categoria}</p>
                    {isSelected && (
                      <div className="absolute top-1 right-1 h-5 w-5 bg-primary rounded-full flex items-center justify-center">
                        <span className="text-white text-xs">✓</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {templateId === 'custom' && (
              <div className="mt-4 p-4 border rounded-lg bg-muted/20">
                <Label className="mb-2 block">Upload do Template (Imagem)</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setCustomTemplateFile(e.target.files?.[0] || null)}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Você pode fazer o upload da imagem inteira do seu template. O sistema usará essa imagem como fundo e adicionará o QR code por cima.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                Voltar
              </Button>
              <Button onClick={() => setStep(3)} className="flex-1" disabled={templateId === 'custom' && !customTemplateFile}>
                Próximo
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: CTA + Conversão */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <Label>CTA Principal</Label>
              <Select
                value={ctaPrincipal}
                onValueChange={(v) => setCtaPrincipal(v as CTAPrincipal)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CTA_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Modo Conversão */}
            <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-500/10 rounded-lg p-4 border border-amber-200 dark:border-amber-500/20">
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold">Modo Conversão</p>
                  <p className="text-xs text-muted-foreground">
                    Abre WhatsApp automaticamente após captura
                  </p>
                </div>
              </div>
              <Switch
                checked={modoConversao}
                onCheckedChange={setModoConversao}
              />
            </div>

            {modoConversao && (
              <div>
                <Label className="flex items-center gap-1">
                  <MessageCircle className="h-4 w-4" /> Mensagem WhatsApp
                </Label>
                <Input
                  value={mensagemWhatsapp}
                  onChange={(e) => setMensagemWhatsapp(e.target.value)}
                  placeholder="Olá, tenho interesse neste imóvel..."
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Se vazio, será gerada automaticamente com o código do imóvel.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                Voltar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading || uploading}
                className="flex-1"
              >
                {(loading || uploading) ? 'Gerando...' : '🚀 Gerar Fachada'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
