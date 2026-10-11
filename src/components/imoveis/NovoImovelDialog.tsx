import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useCRMStore } from '@/stores/crmStore';
import { TipoImovel } from '@/types/crm';
import { useToast } from '@/hooks/use-toast';
import { useImovelFotos } from '@/hooks/useImovelFotos';
import { Progress } from '@/components/ui/progress';
import { MapPin, Home, DollarSign, Loader2, Video, X } from 'lucide-react';
import { ImovelFotosUpload } from './ImovelFotosUpload';
import { ImovelMediaManager } from './ImovelMediaManager';
import { supabase } from '@/integrations/supabase/client';
import { getTrackingData } from '@/hooks/useUTMTracker';
import { useVideos } from '@/hooks/useVideos';
import { useFileDrop } from '@/hooks/useFileDrop';
import { cn } from '@/lib/utils';
import { useCheckLimit } from '@/hooks/useSubscription';
import { podeCriarRecurso } from '@/lib/planos';
import { apiDisponivel } from '@/lib/api';
import { atualizarImovelApi, criarImovelApi } from '@/lib/api/imoveis';
import { ErroApi } from '@/lib/api/http';

type Finalidade = 'VENDA' | 'LOCACAO' | 'AMBOS';

const FINALIDADES: { value: Finalidade; label: string }[] = [
  { value: 'VENDA', label: 'Venda' },
  { value: 'LOCACAO', label: 'Aluguel' },
  { value: 'AMBOS', label: 'Venda e Aluguel' },
];

const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const VIDEO_MAX_BYTES = 500 * 1024 * 1024; // 500MB

interface NovoImovelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imovelToEdit?: any; // Added prop for editing
  /** Recebe o id do imóvel recém-cadastrado (só no modo criação). */
  onCreated?: (imovelId: string) => void;
}

export function NovoImovelDialog({ open, onOpenChange, imovelToEdit, onCreated }: NovoImovelDialogProps) {
  const { addImovel, fetchImoveis } = useCRMStore();
  const { toast } = useToast();
  const { uploadMultipleFotos, uploading } = useImovelFotos();
  const { uploadVideo, uploading: uploadingVideo, uploadProgress: videoProgress } = useVideos();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isEditing = !!imovelToEdit;
  const checkLimit = useCheckLimit();

  // Default values set to empty strings for cleaner UX (users don't have to delete '0')
  const [form, setForm] = useState({
    titulo: '',
    tipo: 'APARTAMENTO' as TipoImovel,
    finalidade: 'VENDA' as Finalidade,
    valor: '',
    area_m2: '',
    dormitorios: '',
    garagem: '',
    endereco: '',
    bairro: '',
    cidade: 'Anápolis', // Changed default city per request
    proprietario_nome: '',
    links_anuncio: '',
    suites: '',
    banheiros: ''
  });

  // Proprietário sai do cadastro rápido e só aparece na edição, onde o registro
  // é completado com calma. Continua obrigatório em locação porque contrato e
  // repasse leem `proprietario_nome` do imóvel.
  const proprietarioObrigatorio = form.finalidade !== 'VENDA';

  // Cômodo não existe em todo imóvel: terreno não tem nenhum, e galpão ou sala
  // comercial não tem dormitório nem suíte. Além de poluir o cadastro, o campo
  // escondido guardaria número velho se o tipo mudasse depois de preenchido —
  // por isso o que não se aplica também é zerado no envio.
  const CAMPOS_POR_TIPO: Record<TipoImovel, {
    dormitorios: boolean; suites: boolean; banheiros: boolean; garagem: boolean;
  }> = {
    APARTAMENTO: { dormitorios: true, suites: true, banheiros: true, garagem: true },
    CASA: { dormitorios: true, suites: true, banheiros: true, garagem: true },
    COMERCIAL: { dormitorios: false, suites: false, banheiros: true, garagem: true },
    TERRENO: { dormitorios: false, suites: false, banheiros: false, garagem: false },
  };
  const camposAplicaveis = CAMPOS_POR_TIPO[form.tipo];
  const numeroSeAplicavel = (aplica: boolean, valor: string) => (aplica ? Number(valor) || 0 : 0);

  const resetForm = () => {
    setForm({
      titulo: '',
      tipo: 'APARTAMENTO',
      finalidade: 'VENDA',
      valor: '',
      area_m2: '',
      dormitorios: '',
      garagem: '',
      endereco: '',
      bairro: '',
      cidade: 'Anápolis',
      proprietario_nome: '',
    links_anuncio: '',
      suites: '',
      banheiros: ''
    });
    setPendingFiles([]);
    setVideoFile(null);
  };

  useEffect(() => {
    if (imovelToEdit && open) {
      setForm({
        titulo: imovelToEdit.titulo || '',
        tipo: imovelToEdit.tipo || 'APARTAMENTO',
        finalidade: (imovelToEdit.finalidade as Finalidade) || 'VENDA',
        valor: imovelToEdit.valor?.toString() || '',
        area_m2: imovelToEdit.area_m2?.toString() || '',
        dormitorios: imovelToEdit.dormitorios?.toString() || '',
        garagem: imovelToEdit.garagem?.toString() || '',
        endereco: imovelToEdit.endereco || '',
        bairro: imovelToEdit.bairro || '',
        cidade: imovelToEdit.cidade || 'Anápolis',
        proprietario_nome: imovelToEdit.proprietario_nome || '',
        links_anuncio: (Array.isArray(imovelToEdit.links_anuncio) ? imovelToEdit.links_anuncio : []).join('\n'),
        suites: imovelToEdit.suites?.toString() || '',
        banheiros: imovelToEdit.banheiros?.toString() || ''
      });
      setVideoFile(null);
    } else if (!open && !imovelToEdit) {
      resetForm();
    }
  }, [imovelToEdit, open]);

  const handleVideoSelect = (file: File | undefined) => {
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type)) {
      toast({ title: 'Formato de vídeo inválido', description: 'Use MP4, WebM, MOV ou AVI.', variant: 'destructive' });
      return;
    }
    if (file.size > VIDEO_MAX_BYTES) {
      toast({ title: 'Vídeo muito grande', description: 'O tamanho máximo é 500MB.', variant: 'destructive' });
      return;
    }
    setVideoFile(file);
  };

  // Drop em <label> é inconsistente entre navegadores — os handlers ficam no wrapper.
  const { dragActive: videoDragActive, dropProps: videoDropProps } = useFileDrop(
    (arquivos) => handleVideoSelect(arquivos[0]),
    { disabled: uploadingVideo },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!podeCriarRecurso(checkLimit('max_imoveis'), isEditing)) {
      toast({
        title: 'Limite de imóveis atingido',
        description: 'Acesse Plano e Assinatura para liberar mais imóveis.',
        variant: 'destructive',
      });
      return;
    }
    setSubmitting(true);

    try {
      let imovel;

      if (apiDisponivel()) {
        // Sem get_corretor_id no navegador: o servidor resolve a conta.
        const campos = {
          titulo: form.titulo,
          tipo: form.tipo,
          finalidade: form.finalidade,
          valor: Number(form.valor.toString().replace(/\./g, '').replace(',', '.')) || 0,
          area_m2: Number(form.area_m2) || 0,
          dormitorios: numeroSeAplicavel(camposAplicaveis.dormitorios, form.dormitorios),
          garagem: numeroSeAplicavel(camposAplicaveis.garagem, form.garagem),
          endereco: form.endereco,
          bairro: form.bairro,
          cidade: form.cidade,
          proprietario_nome: form.proprietario_nome,
          // Um link por linha; só o que começa com http(s) vai (a API recusa o resto).
          links_anuncio: form.links_anuncio.split(/\s+/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)).slice(0, 10),
          suites: numeroSeAplicavel(camposAplicaveis.suites, form.suites),
          banheiros: numeroSeAplicavel(camposAplicaveis.banheiros, form.banheiros),
        };
        imovel = isEditing ? await atualizarImovelApi(imovelToEdit.id, campos) : await criarImovelApi(campos);
      } else if (!isEditing) {
        // Get corretor_id only for new inserts
        const { data: corretorId, error: corretorError } = await supabase.rpc('get_corretor_id');
        if (corretorError || !corretorId) {
          throw new Error('Não foi possível identificar o corretor');
        }

        // Create imovel in database
        const { data, error } = await supabase
          .from('imoveis')
          .insert({
            titulo: form.titulo,
            tipo: form.tipo,
            finalidade: form.finalidade,
            valor: Number(form.valor.toString().replace(/\./g, '').replace(',', '.')) || 0,
            area_m2: Number(form.area_m2) || 0,
            dormitorios: numeroSeAplicavel(camposAplicaveis.dormitorios, form.dormitorios),
            garagem: numeroSeAplicavel(camposAplicaveis.garagem, form.garagem),
            endereco: form.endereco,
            bairro: form.bairro,
            cidade: form.cidade,
            proprietario_nome: form.proprietario_nome,
            corretor_id: corretorId,
            suites: numeroSeAplicavel(camposAplicaveis.suites, form.suites),
            banheiros: numeroSeAplicavel(camposAplicaveis.banheiros, form.banheiros),
          })
          .select()
          .single();

        if (error) throw error;
        imovel = data;

      } else {
        // Update existing
        const { data, error } = await supabase
          .from('imoveis')
          .update({
            titulo: form.titulo,
            tipo: form.tipo,
            finalidade: form.finalidade,
            valor: Number(form.valor.toString().replace(/\./g, '').replace(',', '.')) || 0,
            area_m2: Number(form.area_m2) || 0,
            dormitorios: numeroSeAplicavel(camposAplicaveis.dormitorios, form.dormitorios),
            garagem: numeroSeAplicavel(camposAplicaveis.garagem, form.garagem),
            endereco: form.endereco,
            bairro: form.bairro,
            cidade: form.cidade,
            proprietario_nome: form.proprietario_nome,
            suites: numeroSeAplicavel(camposAplicaveis.suites, form.suites),
            banheiros: numeroSeAplicavel(camposAplicaveis.banheiros, form.banheiros),
          })
          .eq('id', imovelToEdit.id)
          .select()
          .single();

        if (error) throw error;
        imovel = data;
      }

      // Upload photos if any
      if (pendingFiles.length > 0 && imovel) {
        await uploadMultipleFotos(imovel.id, pendingFiles);
      }

      // Upload optional video (não bloqueia o cadastro se falhar)
      if (videoFile && imovel) {
        try {
          await uploadVideo(videoFile, form.titulo || 'Vídeo do imóvel', 'APRESENTACAO', imovel.id);
        } catch {
          // uploadVideo já exibe toast de erro
        }
      }

      toast({ title: `Imóvel ${isEditing ? 'atualizado' : 'cadastrado'} com sucesso!` });
      if (!isEditing) resetForm(); // Only reset if new, keep values if editing? Or close.
      onOpenChange(false);
      fetchImoveis();
      // Deixa quem abriu o dialog continuar de onde parou (ex.: o wizard de Fachada
      // já seleciona o imóvel recém-criado em vez de mandar procurar na lista).
      if (!isEditing && imovel?.id) onCreated?.(imovel.id);
    } catch (error: any) {
      console.error('Erro ao salvar imóvel:', error);
      if (error instanceof ErroApi && error.status === 402) {
        // Cota do plano recusada no servidor: mesmo aviso da checagem feita aqui no navegador.
        toast({
          title: 'Limite de imóveis atingido',
          description: 'Acesse Plano e Assinatura para liberar mais imóveis.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Erro ao salvar imóvel', description: error.message, variant: 'destructive' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open && !imovelToEdit) resetForm();
      onOpenChange(open);
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEditing ? 'Editar Imóvel' : 'Novo Imóvel'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><Label>Título *</Label><Input required value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as TipoImovel })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="APARTAMENTO">Apartamento</SelectItem>
                  <SelectItem value="CASA">Casa</SelectItem>
                  <SelectItem value="COMERCIAL">Comercial</SelectItem>
                  <SelectItem value="TERRENO">Terreno</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor (R$) *</Label>
              <Input
                type="text"
                required
                value={form.valor}
                onChange={(e) => {
                  const rawValue = e.target.value.replace(/\D/g, '');
                  const formatted = new Intl.NumberFormat('pt-BR').format(Number(rawValue));
                  setForm({ ...form, valor: rawValue === '' ? '' : formatted });
                }}
              />
            </div>
          </div>
          <div>
            <Label>Finalidade</Label>
            <Select value={form.finalidade} onValueChange={(v) => setForm({ ...form, finalidade: v as Finalidade })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FINALIDADES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div><Label>Área (m²)</Label><Input type="number" value={form.area_m2} onChange={(e) => setForm({ ...form, area_m2: e.target.value })} /></div>
            {camposAplicaveis.dormitorios && (
              <div><Label>Dorms</Label><Input type="number" value={form.dormitorios} onChange={(e) => setForm({ ...form, dormitorios: e.target.value })} /></div>
            )}
            {camposAplicaveis.suites && (
              <div><Label>Suítes</Label><Input type="number" value={form.suites} onChange={(e) => setForm({ ...form, suites: e.target.value })} /></div>
            )}
            {camposAplicaveis.banheiros && (
              <div><Label>Banheiros</Label><Input type="number" value={form.banheiros} onChange={(e) => setForm({ ...form, banheiros: e.target.value })} /></div>
            )}
            {camposAplicaveis.garagem && (
              <div><Label>Vagas</Label><Input type="number" value={form.garagem} onChange={(e) => setForm({ ...form, garagem: e.target.value })} /></div>
            )}
          </div>
          <div><Label>Endereço *</Label><Input required value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Bairro *</Label><Input required value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} /></div>
            <div><Label>Cidade</Label><Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} /></div>
          </div>
          {isEditing && (
            <div>
              <Label>
                Proprietário{' '}
                {proprietarioObrigatorio
                  ? <span className="text-destructive">*</span>
                  : <span className="text-muted-foreground font-normal">(opcional)</span>}
              </Label>
              <Input
                required={proprietarioObrigatorio}
                value={form.proprietario_nome}
                onChange={(e) => setForm({ ...form, proprietario_nome: e.target.value })}
                placeholder={proprietarioObrigatorio ? 'Nome do proprietário' : 'Opcional para venda'}
              />
            </div>
          )}

          <div>
            <Label>Links dos anúncios <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Textarea rows={3} value={form.links_anuncio} onChange={(e) => setForm({ ...form, links_anuncio: e.target.value })}
              placeholder={'Um link por linha: OLX, ImovelWeb, Zap...\nhttps://www.olx.com.br/...'} />
            <p className="mt-1 text-xs text-muted-foreground">O Assistente IA mostra esses links quando listar o imóvel.</p>
          </div>

          <Separator />

          {isEditing ? (
            <div>
              <Label className="mb-3 block">Fotos e Vídeos do Imóvel</Label>
              <ImovelMediaManager imovelId={imovelToEdit.id} />
            </div>
          ) : (
            <>
          <div>
            <Label className="mb-3 block">Fotos do Imóvel</Label>
            <ImovelFotosUpload
              onFilesSelected={setPendingFiles}
              uploading={uploading}
            />
            {pendingFiles.length > 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                {pendingFiles.length} foto(s) serão enviadas ao salvar
              </p>
            )}
            {isEditing && (
              <p className="text-xs text-muted-foreground mt-2">Novas fotos serão adicionadas à galeria existente.</p>
            )}
          </div>

          <Separator />

          <div>
            <Label className="mb-2 block">
              Vídeo do Imóvel <span className="text-muted-foreground font-normal">(opcional)</span>
            </Label>
            {!videoFile ? (
              <div {...videoDropProps}>
                <label
                  htmlFor="imovel-video-input"
                  className={cn(
                    'flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                    videoDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50',
                  )}
                >
                  <div className="p-3 rounded-full bg-primary/10">
                    <Video className="w-6 h-6 text-primary" />
                  </div>
                  <p className="font-medium">
                    {videoDragActive ? 'Solte o vídeo aqui' : 'Arraste ou clique para adicionar um vídeo'}
                  </p>
                  <p className="text-sm text-muted-foreground">MP4, WebM, MOV ou AVI (máx. 500MB)</p>
                  <input
                    id="imovel-video-input"
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
                    onChange={(e) => {
                      handleVideoSelect(e.target.files?.[0]);
                      e.target.value = ''; // permite re-selecionar o mesmo arquivo depois
                    }}
                    className="hidden"
                    disabled={uploadingVideo}
                  />
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-3 border rounded-lg p-3">
                <div className="p-2 rounded-md bg-primary/10 shrink-0">
                  <Video className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{videoFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
                {!uploadingVideo && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setVideoFile(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}
            {uploadingVideo && (
              <div className="mt-2 space-y-1">
                <Progress value={videoProgress} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">
                  Enviando vídeo... {videoProgress}%
                </p>
              </div>
            )}
          </div>
            </>
          )}

          <Button type="submit" className="w-full" disabled={submitting || uploading || uploadingVideo}>
            {submitting ? 'Salvando...' : (isEditing ? 'Salvar Alterações' : 'Cadastrar Imóvel')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
