import { useState, useEffect, useRef } from 'react';
import { Building2, MessageCircle, Zap, ImagePlus, Trash2, Camera, Loader2, Upload, Plus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
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
import { QrCodePositioner } from './QrCodePositioner';
import { MENSAGEM_PADRAO, montarMensagemDeContato } from '@/lib/fachadas/mensagemContato';
import { moeda } from '@/lib/formato';
import { ImovelMediaManager } from '@/components/imoveis/ImovelMediaManager';
import { NovoImovelDialog } from '@/components/imoveis/NovoImovelDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCRMStore } from '@/stores/crmStore';
import { supabase } from '@/integrations/supabase/client';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useFileDrop } from '@/hooks/useFileDrop';
import { cn } from '@/lib/utils';
import {
  TIPO_NEGOCIO_LABELS,
  CTA_LABELS,
  DEFAULT_TEMPLATES,
} from '@/types/fachada';
import type { TipoNegocio, CTAPrincipal, FachadaComImovel } from '@/types/fachada';
import { useCheckLimit } from '@/hooks/useSubscription';
import { podeCriarRecurso } from '@/lib/planos';

interface CustomTemplateOption {
  id: string;
  nome: string;
  imagem_url: string;
  qrPosition?: { x: number; y: number };
  qrSize?: number;
}

interface CriarFachadaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customTemplates?: CustomTemplateOption[];
  /** Quando presente, o dialog abre em modo edição (pré-preenchido). */
  fachadaToEdit?: FachadaComImovel | null;
  onSubmit: (data: {
    imovel_id: string;
    tipo_negocio: TipoNegocio;
    template_id: string;
    cta_principal: CTAPrincipal;
    modo_conversao: boolean;
    mensagem_whatsapp?: string;
    mensagem_contato?: string;
  }) => Promise<void>;
}

export function CriarFachadaDialog({
  open,
  onOpenChange,
  onSubmit,
  customTemplates = [],
  fachadaToEdit = null,
}: CriarFachadaDialogProps) {
  const isEditing = !!fachadaToEdit;
  const checkLimit = useCheckLimit();
  const { imoveis, fetchImoveis } = useCRMStore();
  const { upload, uploading } = useFileUpload('imoveis-fotos');
  const [step, setStep] = useState(1);
  const [isNovoImovelOpen, setIsNovoImovelOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Formulário
  const [imovelId, setImovelId] = useState('');
  const [tipoNegocio, setTipoNegocio] = useState<TipoNegocio>('VENDA');
  const [templateId, setTemplateId] = useState('venda-classica');
  const [customTemplateFile, setCustomTemplateFile] = useState<File | null>(null);
  const [ctaPrincipal, setCtaPrincipal] = useState<CTAPrincipal>('WHATSAPP');
  const [modoConversao, setModoConversao] = useState(false);
  const [mensagemWhatsapp, setMensagemWhatsapp] = useState('');
  // A abordagem do corretor ao lead. Caminho contrário da de cima.
  const [mensagemContato, setMensagemContato] = useState('');
  
  // Custom Template (Upload Avulso) States
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState<string | null>(null);
  const [qrPosition, setQrPosition] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [qrSizePercent, setQrSizePercent] = useState(45);

  const [isEditarImovelOpen, setIsEditarImovelOpen] = useState(false);
  const selectedImovel = imoveis.find((i) => i.id === imovelId);

  // Modo edição: pré-preenche o form com os dados da fachada.
  useEffect(() => {
    if (fachadaToEdit && open) {
      setImovelId(fachadaToEdit.imovel_id || '');
      setTipoNegocio(fachadaToEdit.tipo_negocio);
      setTemplateId(fachadaToEdit.template_id || 'venda-classica');
      setCtaPrincipal(fachadaToEdit.cta_principal);
      setModoConversao(!!fachadaToEdit.modo_conversao);
      setMensagemWhatsapp(fachadaToEdit.mensagem_whatsapp || '');
      setMensagemContato(fachadaToEdit.mensagem_contato || '');
      setStep(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fachadaToEdit, open]);

  const templateInputRef = useRef<HTMLInputElement>(null);

  const selecionarTemplate = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Envie uma imagem (PNG, JPG ou WEBP).');
      return;
    }
    if (templatePreviewUrl) URL.revokeObjectURL(templatePreviewUrl);
    setCustomTemplateFile(file);
    setTemplatePreviewUrl(URL.createObjectURL(file));
  };

  const { dragActive: templateDragActive, dropProps: templateDropProps } = useFileDrop(
    (arquivos) => selecionarTemplate(arquivos[0]),
    { accept: 'image/*', onReject: () => toast.error('Envie uma imagem (PNG, JPG ou WEBP).') },
  );

  const resetForm = () => {
    setStep(1);
    setImovelId('');
    setTipoNegocio('VENDA');
    setTemplateId('venda-classica');
    setCustomTemplateFile(null);
    setCtaPrincipal('WHATSAPP');
    setModoConversao(false);
    setMensagemWhatsapp('');
    if (templatePreviewUrl) URL.revokeObjectURL(templatePreviewUrl);
    setTemplatePreviewUrl(null);
    setQrPosition({ x: 50, y: 50 });
    setQrSizePercent(20);
  };

  const handleSubmit = async () => {
    if (!imovelId) return;
    if (!podeCriarRecurso(checkLimit('max_fachadas'), isEditing)) {
      toast.error('Limite de Fachadas Inteligentes atingido. Veja as opções de plano.');
      return;
    }
    setLoading(true);
    try {
      let finalTemplateId = templateId;

      // Upload do template customizado
      if (templateId === 'custom' && customTemplateFile) {
        // O corretor vem ANTES do upload: a policy de storage escopa a gravação
        // por `fachadas/<corretor_id>/`, então o caminho precisa carregá-lo.
        const { data: corretorId } = await supabase.rpc('get_corretor_id');
        if (!corretorId) {
          throw new Error('Não foi possível identificar sua conta. Recarregue a página e tente de novo.');
        }

        const ext = customTemplateFile.name.split('.').pop();
        const fileName = `fachada-template-${Date.now()}.${ext}`;
        const result = await upload(customTemplateFile, `fachadas/${corretorId}/${fileName}`);
        // Sem arte não há fachada personalizada. Seguir em silêncio deixaria
        // `finalTemplateId` como a string 'custom', que não é um template.
        if (!result?.url) throw new Error('Não foi possível enviar a arte do template.');

        finalTemplateId = result.url;

        try {
          // `fachada_templates` ainda não está no types.ts gerado — mesmo cast usado
          // no resto do projeto (crmStore, NewContractDialog) enquanto os tipos não sobem.
          await (supabase as any).from('fachada_templates').insert({
            corretor_id: corretorId,
            nome: `Avulso - ${selectedImovel?.titulo || 'Imóvel'}`,
            categoria: tipoNegocio,
            padrao: false,
            config: {
              imagem_url: result.url,
              qrPosition: { x: qrPosition.x, y: qrPosition.y },
              qrSize: qrSizePercent,
              corPrimaria: '#000000',
              corSecundaria: '#ffffff',
              corTexto: '#ffffff',
              corFundo: '#000000',
              estilo: 'profissional',
              layout: 'vertical',
            },
          } as any);
        } catch (e) {
          // Aqui o catch é intencional e diferente do outro caso: a fachada já
          // tem a arte pelo `finalTemplateId`, e ela funciona mesmo que o
          // template não fique salvo na biblioteca para reuso. Falhar a criação
          // inteira por causa do reuso seria pior para quem está criando.
          console.error('Erro ao salvar template avulso na biblioteca:', e);
        }
      }

      await onSubmit({
        imovel_id: imovelId,
        tipo_negocio: tipoNegocio,
        template_id: finalTemplateId,
        cta_principal: ctaPrincipal,
        modo_conversao: modoConversao,
        mensagem_whatsapp: mensagemWhatsapp || undefined,
        mensagem_contato: mensagemContato || undefined,
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
            {isEditing ? 'Editar Fachada' : 'Criar Nova Fachada'}
          </DialogTitle>
          <DialogDescription>
            Etapa {step} de 4 — {step === 1 ? 'Selecionar Imóvel' : step === 2 ? 'Template e Tipo' : step === 3 ? 'CTA e Conversão' : 'Mídias do Imóvel'}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper visual */}
        <div className="flex gap-1 mb-4">
          {[1, 2, 3, 4].map((s) => (
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
              <div className="flex items-center justify-between mb-1">
                <Label>Imóvel *</Label>
                {/* Cadastrar sem abandonar o wizard: antes era preciso sair, ir na aba
                    Imóveis, cadastrar e recomeçar a fachada do zero. */}
                <div className="flex items-center gap-3">
                  {/* Editar o imóvel da própria fachada, sem sair daqui. Antes
                      era preciso fechar o wizard, ir na aba Imóveis, editar e
                      recomeçar — e no modo edição isso significava perder o
                      progresso das 4 etapas. */}
                  {selectedImovel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="h-auto p-0 text-xs text-primary hover:text-primary/80"
                      onClick={() => setIsEditarImovelOpen(true)}
                    >
                      <Pencil className="w-3 h-3 mr-1" /> Editar imóvel
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="h-auto p-0 text-xs text-primary hover:text-primary/80"
                    onClick={() => setIsNovoImovelOpen(true)}
                  >
                    <Plus className="w-3 h-3 mr-1" /> Novo Imóvel
                  </Button>
                </div>
              </div>
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
              {imoveis.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Nenhum imóvel cadastrado ainda — use "Novo Imóvel" aqui mesmo.
                </p>
              )}
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
              {/* Meus Templates Personalizados */}
              {customTemplates.map((ct) => {
                const isSelected = templateId === ct.imagem_url;
                return (
                  <button
                    key={ct.id}
                    onClick={() => setTemplateId(ct.imagem_url)}
                    className={`relative rounded-xl overflow-hidden text-center transition-all border-2 ${
                      isSelected
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-transparent hover:border-muted-foreground/20'
                    }`}
                  >
                    <div className="h-20 bg-black">
                      <img
                        src={ct.imagem_url}
                        alt={ct.nome}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="p-2 bg-card">
                      <p className="text-xs font-bold truncate">{ct.nome}</p>
                      <p className="text-[9px] text-primary opacity-80 flex items-center justify-center gap-0.5 mt-0.5">
                        <ImagePlus className="h-2.5 w-2.5" />
                        Personalizado
                      </p>
                    </div>
                    {isSelected && (
                      <div className="absolute top-1 right-1 h-5 w-5 bg-primary rounded-full flex items-center justify-center">
                        <span className="text-white text-xs">✓</span>
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Opção Upload Avulso */}
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
                  <p className="text-[10px] opacity-60">Upload Avulso</p>
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
                <Label className="mb-2 block">Upload do Template (Imagem) *</Label>
                {templatePreviewUrl ? (
                  <QrCodePositioner
                    imageSrc={templatePreviewUrl}
                    position={qrPosition}
                    onPositionChange={setQrPosition}
                    qrSizePercent={qrSizePercent}
                    onSizeChange={setQrSizePercent}
                    removeButton={
                      <button
                        onClick={() => {
                          setCustomTemplateFile(null);
                          URL.revokeObjectURL(templatePreviewUrl);
                          setTemplatePreviewUrl(null);
                        }}
                        className="absolute top-2 right-2 p-1.5 bg-red-500/80 rounded-lg hover:bg-red-600 transition z-50"
                      >
                        <Trash2 className="h-4 w-4 text-white" />
                      </button>
                    }
                  />
                ) : (
                  <>
                    <input
                      ref={templateInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        selecionarTemplate(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      {...templateDropProps}
                      onClick={() => templateInputRef.current?.click()}
                      className={cn(
                        'w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 text-center transition-colors',
                        templateDragActive
                          ? 'border-primary bg-primary/5'
                          : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30',
                      )}
                    >
                      <div className="p-3 rounded-full bg-primary/10">
                        <Upload className="h-5 w-5 text-primary" />
                      </div>
                      <p className="text-sm font-medium">
                        {templateDragActive ? 'Solte a arte aqui' : 'Arraste ou clique para enviar a arte'}
                      </p>
                      <p className="text-xs text-muted-foreground">PNG, JPG ou WEBP</p>
                    </button>
                  </>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Faça o upload da arte da sua fachada. Ajuste o tamanho e a posição do QR Code arrastando a marcação na imagem.
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

            <div>
              <Label className="flex items-center gap-1">
                <MessageCircle className="h-4 w-4" /> Sua mensagem ao contactar o lead
              </Label>
              <Input
                value={mensagemContato}
                onChange={(event) => setMensagemContato(event.target.value)}
                placeholder={MENSAGEM_PADRAO}
                maxLength={600}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                É o texto que abre no WhatsApp quando você clica em "Contactar" na
                lista de leads. Use <code>{'{nome}'}</code>, <code>{'{imovel}'}</code> e{' '}
                <code>{'{valor}'}</code> — são preenchidos com os dados de quem escaneou
                esta placa. Vazio usa o texto padrão.
              </p>
              {mensagemContato.trim() && <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">
                <span className="text-muted-foreground">Prévia: </span>
                {montarMensagemDeContato(mensagemContato, {
                  nome: 'Maria Silva',
                  imovel: selectedImovel?.titulo ?? 'Apartamento 302',
                  valor: selectedImovel?.valor ? moeda(selectedImovel.valor) : 'R$ 450.000',
                })}
              </p>}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                Voltar
              </Button>
              <Button onClick={() => setStep(4)} className="flex-1">
                Próximo
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Mídias do Imóvel */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Camera className="h-4 w-4 text-primary" />
              <Label className="text-sm font-semibold">Mídias do Imóvel</Label>
              <span className="text-[10px] px-2 py-0.5 bg-muted rounded-full text-muted-foreground">Opcional</span>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Envie fotos e vídeos do imóvel. Eles ficarão disponíveis tanto aqui quanto na página do imóvel automaticamente.
            </p>

            {imovelId && <ImovelMediaManager imovelId={imovelId} />}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(3)} className="flex-1">
                Voltar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading || uploading}
                className="flex-1"
              >
                {(loading || uploading)
                  ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {isEditing ? 'Salvando...' : 'Gerando...'}
                    </>
                  )
                  : (isEditing ? '💾 Salvar Alterações' : '🚀 Gerar Fachada')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      {/* Cadastro rápido de imóvel — fora do DialogContent, mesmo padrão do
          NewContractDialog. Ao criar, já seleciona o novo imóvel no passo 1. */}
      <NovoImovelDialog
        open={isNovoImovelOpen}
        onOpenChange={setIsNovoImovelOpen}
        onCreated={(novoId) => setImovelId(novoId)}
      />

      {/* Mesmo componente em modo edição — não há tela nova a manter. Ao
          fechar, recarrega os imóveis para o resumo abaixo refletir a mudança.
          O id da fachada NÃO é tocado aqui: o QR impresso continua o mesmo. */}
      <NovoImovelDialog
        open={isEditarImovelOpen}
        onOpenChange={(aberto) => {
          setIsEditarImovelOpen(aberto);
          if (!aberto) void fetchImoveis();
        }}
        imovelToEdit={selectedImovel}
      />
    </Dialog>
  );
}
