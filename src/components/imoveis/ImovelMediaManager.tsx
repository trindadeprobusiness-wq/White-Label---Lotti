import { useEffect, useRef, useState } from 'react';
import { Camera, Film, Star, Trash2, Loader2, Plus, Play } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useImovelFotos } from '@/hooks/useImovelFotos';
import { useVideos } from '@/hooks/useVideos';
import { useFileDrop } from '@/hooks/useFileDrop';
import { OrganizarFotosIA } from './OrganizarFotosIA';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE = 5 * 1024 * 1024; // 5MB
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const MAX_VIDEO = 500 * 1024 * 1024; // 500MB

interface ImovelMediaManagerProps {
  /** Imóvel dono da mídia. A mídia é compartilhada (imovel_fotos / videos), então
   *  qualquer alteração aqui reflete no imóvel E em qualquer fachada ligada a ele. */
  imovelId: string;
  maxFotos?: number;
  maxVideos?: number;
  className?: string;
}

/**
 * Gerenciador de mídia do imóvel — FONTE ÚNICA compartilhada entre a aba Imóveis
 * e as Fachadas. Lê/escreve direto em `imovel_fotos` e `videos` (por imovel_id).
 * Todas as operações são imediatas (ao vivo): adicionar, remover e definir principal.
 */
export function ImovelMediaManager({
  imovelId,
  maxFotos = 50,
  maxVideos = 5,
  className,
}: ImovelMediaManagerProps) {
  const {
    fotos,
    loading: loadingFotos,
    uploading: uploadingFoto,
    fetchFotos,
    uploadMultipleFotos,
    deleteFoto,
    reordenarFotos,
    setFotoPrincipal,
  } = useImovelFotos(imovelId);
  const {
    videos: allVideos,
    uploading: uploadingVideo,
    uploadProgress,
    fetchVideos,
    uploadVideo,
    deleteVideo,
  } = useVideos();

  const fotoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const videos = allVideos.filter((v) => v.imovel_id === imovelId);
  const busy = uploadingFoto || uploadingVideo;

  useEffect(() => {
    if (imovelId) fetchFotos(imovelId);
  }, [imovelId, fetchFotos]);

  const handleAddFotos = async (all: File[]) => {
    if (!all.length) return;
    const validas = all.filter((f) => IMAGE_TYPES.includes(f.type) && f.size <= MAX_IMAGE);
    const invalidas = all.length - validas.length;
    if (invalidas > 0) {
      toast.error(`${invalidas} arquivo(s) ignorado(s) (use JPEG/PNG/WebP até 5MB)`);
    }
    const espaco = maxFotos - fotos.length;
    if (espaco <= 0) {
      toast.error(`Limite de ${maxFotos} fotos atingido`);
      return;
    }
    await uploadMultipleFotos(imovelId, validas.slice(0, espaco));
  };

  const handleAddVideo = async (arquivos: File[]) => {
    const file = arquivos[0];
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type)) {
      toast.error('Formato de vídeo inválido (use MP4, WebM, MOV ou AVI)');
      return;
    }
    if (file.size > MAX_VIDEO) {
      toast.error('Vídeo muito grande (máx. 500MB)');
      return;
    }
    if (videos.length >= maxVideos) {
      toast.error(`Limite de ${maxVideos} vídeos atingido`);
      return;
    }
    await uploadVideo(file, file.name.replace(/\.[^/.]+$/, ''), 'OUTRO', imovelId);
    await fetchVideos();
  };

  const handleDeleteVideo = async (id: string, path?: string) => {
    await deleteVideo(id, path);
    await fetchVideos();
  };

  // A área de drop é a grade inteira, não só o quadradinho de "+".
  const dropFotos = useFileDrop(handleAddFotos, { multiple: true, disabled: busy });
  const dropVideo = useFileDrop(handleAddVideo, { disabled: busy });

  // Reordenar arrastando. A ordem das fotos é o que o visitante vê na fachada
  // pública, e até agora era só a ordem de upload — sem como mudar.
  const [arrastando, setArrastando] = useState<number | null>(null);

  const soltarNaPosicao = (destino: number) => {
    const origem = arrastando;
    setArrastando(null);
    if (origem === null || origem === destino) return;

    const ids = fotos.map((f) => f.id);
    const [movida] = ids.splice(origem, 1);
    ids.splice(destino, 0, movida);
    void reordenarFotos(imovelId, ids);
  };

  return (
    <div className={cn('space-y-5', className)}>
      {/* Aviso de sincronização */}
      <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/10 p-2.5 text-xs text-muted-foreground">
        <span className="text-sm leading-none">🔗</span>
        <p>
          Fotos e vídeos são <strong className="text-foreground">compartilhados</strong> com o
          cadastro do imóvel. Adicionar, remover ou definir a foto principal aqui reflete
          automaticamente na aba Imóveis <strong className="text-foreground">e</strong> nas fachadas
          deste imóvel.
        </p>
      </div>

      {/* ── Fotos ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Camera className="h-4 w-4 text-primary" />
            Fotos
            <span className="text-xs text-muted-foreground font-normal">
              {fotos.length}/{maxFotos}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {loadingFotos && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <OrganizarFotosIA
              imovelId={imovelId}
              fotos={fotos}
              disabled={busy}
              onOrdenar={(ids) => reordenarFotos(imovelId, ids)}
            />
          </div>
        </div>

        <input
          ref={fotoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            handleAddFotos(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />

        <div
          {...dropFotos.dropProps}
          className={cn(
            'grid grid-cols-3 sm:grid-cols-4 gap-2.5 rounded-lg transition',
            dropFotos.dragActive && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
          )}
        >
          {fotos.map((foto, indice) => (
            <div
              key={foto.id}
              draggable={!busy}
              onDragStart={() => setArrastando(indice)}
              onDragEnd={() => setArrastando(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); soltarNaPosicao(indice); }}
              className={cn(
                'relative group aspect-square rounded-lg overflow-hidden border bg-muted transition',
                busy ? 'border-border' : 'border-border cursor-grab active:cursor-grabbing',
                arrastando === indice && 'opacity-40 ring-2 ring-primary',
              )}
            >
              <img src={foto.arquivo_url} alt="" className="w-full h-full object-cover pointer-events-none" />

              {/* A posição é o que o visitante vê na fachada, então mostrar o número
                  deixa claro que a ordem é editável e o que arrastar mudou. */}
              <div className="absolute bottom-1 right-1 h-5 min-w-5 px-1 rounded bg-black/70 text-white text-[10px] font-semibold flex items-center justify-center">
                {indice + 1}
              </div>

              {foto.principal && (
                <div className="absolute top-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary text-primary-foreground text-[9px] font-semibold">
                  <Star className="h-2.5 w-2.5 fill-current" /> Principal
                </div>
              )}

              {/* Ações */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                {!foto.principal && (
                  <button
                    type="button"
                    title="Definir como principal"
                    disabled={busy}
                    onClick={() => setFotoPrincipal(foto.id, imovelId)}
                    className="p-1.5 rounded-full bg-white/90 text-amber-600 hover:bg-white transition disabled:opacity-50"
                  >
                    <Star className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  title="Remover foto"
                  disabled={busy}
                  onClick={() => deleteFoto(foto.id, foto.arquivo_path)}
                  className="p-1.5 rounded-full bg-white/90 text-destructive hover:bg-white transition disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* Adicionar */}
          {fotos.length < maxFotos && (
            <button
              type="button"
              disabled={busy}
              onClick={() => fotoInputRef.current?.click()}
              className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/[0.03] transition flex flex-col items-center justify-center gap-1 text-muted-foreground disabled:opacity-50"
            >
              {uploadingFoto ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Plus className="h-5 w-5" />
                  <span className="text-[10px]">Foto</span>
                </>
              )}
            </button>
          )}
        </div>

        {fotos.length === 0 && !loadingFotos && (
          <p className="text-xs text-muted-foreground mt-2">
            Nenhuma foto ainda. Arraste as fotos para cá ou clique no +. A primeira enviada vira a principal.
          </p>
        )}

        {fotos.length > 1 && (
          <p className="text-xs text-muted-foreground mt-2">
            Arraste as miniaturas para mudar a ordem — é a mesma ordem que o cliente vê na fachada.
          </p>
        )}
      </div>

      {/* ── Vídeos ── */}
      <div>
        <div className="flex items-center gap-1.5 text-sm font-medium mb-2">
          <Film className="h-4 w-4 text-primary" />
          Vídeos
          <span className="text-xs text-muted-foreground font-normal">
            {videos.length}/{maxVideos}
          </span>
        </div>

        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            handleAddVideo(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />

        <div
          {...dropVideo.dropProps}
          className={cn(
            'grid grid-cols-2 sm:grid-cols-3 gap-2.5 rounded-lg transition',
            dropVideo.dragActive && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
          )}
        >
          {videos.map((video) => (
            <div
              key={video.id}
              className="relative group aspect-video rounded-lg overflow-hidden border border-border bg-black"
            >
              {video.thumbnail_url ? (
                <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <video src={video.video_url} className="w-full h-full object-cover" muted preload="metadata" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                <div className="p-1.5 rounded-full bg-white/20 backdrop-blur-sm">
                  <Play className="h-4 w-4 text-white fill-white" />
                </div>
              </div>
              <p className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-[10px] text-white bg-gradient-to-t from-black/80 to-transparent truncate">
                {video.titulo}
              </p>
              <button
                type="button"
                title="Remover vídeo"
                disabled={busy}
                onClick={() => handleDeleteVideo(video.id, video.video_path)}
                className="absolute top-1 right-1 p-1 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}

          {videos.length < maxVideos && (
            <button
              type="button"
              disabled={busy}
              onClick={() => videoInputRef.current?.click()}
              className="aspect-video rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/[0.03] transition flex flex-col items-center justify-center gap-1 text-muted-foreground disabled:opacity-50"
            >
              {uploadingVideo ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-[10px]">{uploadProgress}%</span>
                </>
              ) : (
                <>
                  <Plus className="h-5 w-5" />
                  <span className="text-[10px]">Vídeo</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
