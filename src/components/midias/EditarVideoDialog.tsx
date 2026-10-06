import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { VideoRow, TipoVideo } from '@/hooks/useVideos';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { opcoesImoveisApi } from '@/lib/api/contratos';

interface ImovelSimples {
  id: string;
  titulo: string;
}

interface EditarVideoDialogProps {
  video: VideoRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, updates: Partial<Pick<VideoRow, 'titulo' | 'descricao' | 'tipo' | 'imovel_id'>>) => Promise<void>;
}

const TIPOS_VIDEO: { value: TipoVideo; label: string }[] = [
  { value: 'TOUR_VIRTUAL', label: 'Tour Virtual' },
  { value: 'APRESENTACAO', label: 'Apresentação' },
  { value: 'DEPOIMENTO', label: 'Depoimento' },
  { value: 'DRONE', label: 'Drone/Aéreo' },
  { value: 'INSTITUCIONAL', label: 'Institucional' },
  { value: 'OUTRO', label: 'Outro' },
];

export function EditarVideoDialog({ video, open, onOpenChange, onUpdate }: EditarVideoDialogProps) {
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TipoVideo>('OUTRO');
  const [descricao, setDescricao] = useState('');
  const [imovelId, setImovelId] = useState('');
  const [imoveis, setImoveis] = useState<ImovelSimples[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchImoveis = async () => {
      if (apiDisponivel()) {
        setImoveis(await opcoesImoveisApi<ImovelSimples>(['id', 'titulo']).catch(() => []));
        return;
      }
      const { data } = await supabase.from('imoveis').select('id, titulo').order('titulo');
      if (data) setImoveis(data);
    };
    fetchImoveis();
  }, []);

  useEffect(() => {
    if (video) {
      setTitulo(video.titulo);
      setTipo(video.tipo);
      setDescricao(video.descricao || '');
      setImovelId(video.imovel_id || 'NENHUM');
    }
  }, [video]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!video || !titulo.trim()) return;

    try {
      setSaving(true);
      await onUpdate(video.id, {
        titulo: titulo.trim(),
        tipo,
        descricao: descricao.trim() || null,
        imovel_id: imovelId && imovelId !== 'NENHUM' ? imovelId : null,
      });
      onOpenChange(false);
    } catch (error) {
      // Error handled in hook
    } finally {
      setSaving(false);
    }
  };

  if (!video) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Vídeo</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-titulo">Título *</Label>
            <Input
              id="edit-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Nome do vídeo"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo de Vídeo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoVideo)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o tipo" />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_VIDEO.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Vincular a Imóvel</Label>
            <Select value={imovelId} onValueChange={setImovelId}>
              <SelectTrigger>
                <SelectValue placeholder="Nenhum imóvel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NENHUM">Nenhum</SelectItem>
                {imoveis.map((im) => (
                  <SelectItem key={im.id} value={im.id}>{im.titulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-descricao">Descrição</Label>
            <Textarea
              id="edit-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descrição do vídeo..."
              rows={3}
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !titulo.trim()}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar Alterações'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
