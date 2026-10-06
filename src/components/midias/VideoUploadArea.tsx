import { useState, useRef, useEffect } from 'react';
import { Upload, Video, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { TipoVideo } from '@/hooks/useVideos';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { opcoesImoveisApi } from '@/lib/api/contratos';

interface ImovelSimples {
  id: string;
  titulo: string;
}

interface VideoUploadAreaProps {
  onUpload: (file: File, titulo: string, tipo: TipoVideo, imovelId?: string, descricao?: string) => Promise<unknown>;
  uploading: boolean;
  uploadProgress: number;
}

const TIPOS_VIDEO: { value: TipoVideo; label: string }[] = [
  { value: 'TOUR_VIRTUAL', label: 'Tour Virtual' },
  { value: 'APRESENTACAO', label: 'Apresentação' },
  { value: 'DEPOIMENTO', label: 'Depoimento' },
  { value: 'DRONE', label: 'Drone/Aéreo' },
  { value: 'INSTITUCIONAL', label: 'Institucional' },
  { value: 'OUTRO', label: 'Outro' },
];

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];

export function VideoUploadArea({ onUpload, uploading, uploadProgress }: VideoUploadAreaProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TipoVideo>('OUTRO');
  const [descricao, setDescricao] = useState('');
  const [imovelId, setImovelId] = useState<string>('');
  const [imoveis, setImoveis] = useState<ImovelSimples[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (selectedFile) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [selectedFile]);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Formato inválido. Use MP4, WebM, MOV ou AVI.';
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'Arquivo muito grande. Máximo: 500MB.';
    }
    return null;
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const error = validateFile(file);
      if (error) {
        alert(error);
        return;
      }
      setSelectedFile(file);
      if (!titulo) setTitulo(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const error = validateFile(file);
      if (error) {
        alert(error);
        return;
      }
      setSelectedFile(file);
      if (!titulo) setTitulo(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile || !titulo.trim()) return;

    try {
      await onUpload(
        selectedFile,
        titulo.trim(),
        tipo,
        imovelId && imovelId !== 'NENHUM' ? imovelId : undefined,
        descricao.trim() || undefined
      );
      
      // Reset form
      setSelectedFile(null);
      setTitulo('');
      setTipo('OUTRO');
      setDescricao('');
      setImovelId('');
    } catch (error) {
      // Error handled in hook
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    setTitulo('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 transition-colors text-center",
          dragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50",
          uploading && "pointer-events-none opacity-50"
        )}
      >
        {!selectedFile ? (
          <>
            <Video className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">
              Arraste um vídeo aqui ou clique para selecionar
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              MP4, WebM, MOV, AVI (máx. 500MB)
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
              onChange={handleChange}
              className="hidden"
              id="video-upload"
            />
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Selecionar Vídeo
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            {/* Video Preview */}
            <div className="relative max-w-md mx-auto">
              {previewUrl && (
                <video
                  src={previewUrl}
                  controls
                  className="w-full rounded-lg max-h-48 object-contain bg-black"
                />
              )}
              <Button
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={clearFile}
                disabled={uploading}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
            </p>
          </div>
        )}
      </div>

      {/* Form Fields */}
      {selectedFile && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="video-titulo">Título *</Label>
            <Input
              id="video-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Nome do vídeo"
              disabled={uploading}
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo de Vídeo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoVideo)} disabled={uploading}>
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
            <Label>Vincular a Imóvel (opcional)</Label>
            <Select value={imovelId} onValueChange={setImovelId} disabled={uploading}>
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

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="video-descricao">Descrição (opcional)</Label>
            <Textarea
              id="video-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descrição do vídeo..."
              rows={2}
              maxLength={500}
              disabled={uploading}
            />
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {uploading && (
        <div className="space-y-2">
          <Progress value={uploadProgress} className="h-2" />
          <p className="text-sm text-center text-muted-foreground">
            Enviando vídeo... {uploadProgress}%
          </p>
        </div>
      )}

      {/* Submit Button */}
      {selectedFile && (
        <Button
          onClick={handleSubmit}
          disabled={uploading || !titulo.trim()}
          className="w-full"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Enviando...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Enviar Vídeo
            </>
          )}
        </Button>
      )}
    </div>
  );
}
