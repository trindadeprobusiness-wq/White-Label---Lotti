import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
}

export function NovoImovelDialog({ open, onOpenChange, imovelToEdit }: NovoImovelDialogProps) {
  const { addImovel, fetchImoveis } = useCRMStore();
  const { toast } = useToast();
  const { uploadMultipleFotos, uploading } = useImovelFotos();
  const { uploadVideo, uploading: uploadingVideo, uploadProgress: videoProgress } = useVideos();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isEditing = !!imovelToEdit;

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
    suites: '',
    banheiros: ''
  });

  // Proprietário só é obrigatório quando envolve locação (aluguel). Em venda pura é opcional.
  const proprietarioObrigatorio = form.finalidade !== 'VENDA';

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
    setSubmitting(true);

    try {
      let imovel;

      if (!isEditing) {
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
            dormitorios: Number(form.dormitorios) || 0,
            garagem: Number(form.garagem) || 0,
            endereco: form.endereco,
            bairro: form.bairro,
            cidade: form.cidade,
            proprietario_nome: form.proprietario_nome,
            corretor_id: corretorId,
            suites: Number(form.suites) || 0,
            banheiros: Number(form.banheiros) || 0,
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
            dormitorios: Number(form.dormitorios) || 0,
            garagem: Number(form.garagem) || 0,
            endereco: form.endereco,
            bairro: form.bairro,
            cidade: form.cidade,
            proprietario_nome: form.proprietario_nome,
            suites: Number(form.suites) || 0,
            banheiros: Number(form.banheiros) || 0,
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
    } catch (error: any) {
      console.error('Erro ao salvar imóvel:', error);
      toast({ title: 'Erro ao salvar imóvel', description: error.message, variant: 'destructive' });
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
            <div><Label>Dorms</Label><Input type="number" value={form.dormitorios} onChange={(e) => setForm({ ...form, dormitorios: e.target.value })} /></div>
            <div><Label>Suítes</Label><Input type="number" value={form.suites} onChange={(e) => setForm({ ...form, suites: e.target.value })} /></div>
            <div><Label>Banheiros</Label><Input type="number" value={form.banheiros} onChange={(e) => setForm({ ...form, banheiros: e.target.value })} /></div>
            <div><Label>Vagas</Label><Input type="number" value={form.garagem} onChange={(e) => setForm({ ...form, garagem: e.target.value })} /></div>
          </div>
          <div><Label>Endereço *</Label><Input required value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Bairro *</Label><Input required value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} /></div>
            <div><Label>Cidade</Label><Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} /></div>
          </div>
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
