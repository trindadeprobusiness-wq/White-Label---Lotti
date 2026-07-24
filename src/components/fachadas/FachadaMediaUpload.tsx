import { useState, useRef, useCallback } from 'react';
import { Upload, X, Image, Video, Film, Camera, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

interface MediaFile {
  id: string;
  file: File;
  preview: string;
  type: 'image' | 'video';
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
}

interface FachadaMediaUploadProps {
  onImagesSelected: (files: File[]) => void;
  onVideoSelected?: (file: File) => void;
  existingPhotosCount?: number;
  existingVideosCount?: number;
  uploading?: boolean;
  maxImages?: number;
  maxVideos?: number;
  compact?: boolean;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB

export function FachadaMediaUpload({
  onImagesSelected,
  onVideoSelected,
  existingPhotosCount = 0,
  existingVideosCount = 0,
  uploading = false,
  maxImages = 10,
  maxVideos = 3,
  compact = false,
}: FachadaMediaUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [uploadedCount] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const imageCount = mediaFiles.filter(f => f.type === 'image').length;
  const videoCount = mediaFiles.filter(f => f.type === 'video').length;
  const canAddImages = imageCount + existingPhotosCount < maxImages;
  const canAddVideos = videoCount + existingVideosCount < maxVideos;

  const validateFile = (file: File): { valid: boolean; type: 'image' | 'video'; error?: string } => {
    if (IMAGE_TYPES.includes(file.type)) {
      if (file.size > MAX_IMAGE_SIZE) {
        return { valid: false, type: 'image', error: `${file.name}: Imagem muito grande (máx. 5MB)` };
      }
      return { valid: true, type: 'image' };
    }
    if (VIDEO_TYPES.includes(file.type)) {
      if (file.size > MAX_VIDEO_SIZE) {
        return { valid: false, type: 'video', error: `${file.name}: Vídeo muito grande (máx. 500MB)` };
      }
      return { valid: true, type: 'video' };
    }
    return { valid: false, type: 'image', error: `${file.name}: Formato não suportado` };
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newMediaFiles: MediaFile[] = [];

    for (const file of fileArray) {
      const validation = validateFile(file);
      if (!validation.valid) continue;

      if (validation.type === 'image' && imageCount + newMediaFiles.filter(f => f.type === 'image').length + existingPhotosCount >= maxImages) continue;
      if (validation.type === 'video' && videoCount + newMediaFiles.filter(f => f.type === 'video').length + existingVideosCount >= maxVideos) continue;

      newMediaFiles.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: URL.createObjectURL(file),
        type: validation.type,
        status: 'pending',
        progress: 0,
      });
    }

    if (newMediaFiles.length > 0) {
      setMediaFiles(prev => {
        const updated = [...prev, ...newMediaFiles];
        // Notify parent with all images
        const allImages = updated.filter(f => f.type === 'image').map(f => f.file);
        onImagesSelected(allImages);
        return updated;
      });

      // Notify parent about videos
      const newVideos = newMediaFiles.filter(f => f.type === 'video').map(f => f.file);
      if (newVideos.length > 0 && onVideoSelected) {
        newVideos.forEach(v => onVideoSelected(v));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageCount, videoCount, existingPhotosCount, existingVideosCount, maxImages, maxVideos, onImagesSelected, onVideoSelected]);

  const removeFile = (id: string) => {
    setMediaFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file) URL.revokeObjectURL(file.preview);
      const updated = prev.filter(f => f.id !== id);

      // Notify parent about remaining images
      const remainingImages = updated.filter(f => f.type === 'image').map(f => f.file);
      onImagesSelected(remainingImages);

      return updated;
    });
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Stats Badges */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-xs font-medium text-blue-600 dark:text-blue-400">
          <Camera className="h-3.5 w-3.5" />
          {imageCount + existingPhotosCount} / {maxImages} fotos
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-xs font-medium text-purple-600 dark:text-purple-400">
          <Film className="h-3.5 w-3.5" />
          {videoCount + existingVideosCount} / {maxVideos} vídeos
        </div>
        {mediaFiles.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {mediaFiles.length} arquivo(s) selecionado(s)
          </div>
        )}
      </div>

      {/* Drop Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          'relative border-2 border-dashed rounded-xl transition-all duration-300 cursor-pointer overflow-hidden',
          compact ? 'p-4' : 'p-6',
          dragActive
            ? 'border-primary bg-primary/5 scale-[1.01] shadow-lg shadow-primary/10'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/[0.02]',
          uploading && 'pointer-events-none opacity-50'
        )}
        onClick={() => imageInputRef.current?.click()}
      >
        {/* Drag overlay animation */}
        {dragActive && (
          <div className="absolute inset-0 bg-primary/5 flex items-center justify-center z-10 animate-in fade-in duration-200">
            <div className="text-center">
              <Upload className="h-10 w-10 text-primary mx-auto mb-2 animate-bounce" />
              <p className="text-sm font-semibold text-primary">Solte os arquivos aqui!</p>
            </div>
          </div>
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          multiple
          onChange={handleFileChange}
          className="hidden"
          disabled={uploading}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          onChange={handleFileChange}
          className="hidden"
          disabled={uploading}
        />

        <div className="flex flex-col items-center gap-3 relative z-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-blue-500/10 transition">
              <Image className="h-6 w-6 text-blue-500" />
            </div>
            <div className="p-3 rounded-xl bg-purple-500/10 transition">
              <Video className="h-6 w-6 text-purple-500" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">
              Arraste fotos e vídeos ou clique para selecionar
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Fotos: JPEG, PNG, WebP (máx. 5MB) • Vídeos: MP4, WebM, MOV (máx. 500MB)
            </p>
          </div>
        </div>
      </div>

      {/* Quick action buttons */}
      <div className="flex gap-2">
        {canAddImages && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              imageInputRef.current?.click();
            }}
            disabled={uploading}
          >
            <Camera className="h-3.5 w-3.5" />
            Adicionar Fotos
          </Button>
        )}
        {canAddVideos && onVideoSelected && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              videoInputRef.current?.click();
            }}
            disabled={uploading}
          >
            <Film className="h-3.5 w-3.5" />
            Adicionar Vídeo
          </Button>
        )}
      </div>

      {/* Preview Grid */}
      {mediaFiles.length > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {mediaFiles.map((media, index) => (
              <div
                key={media.id}
                className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-black/5 dark:bg-white/5"
              >
                {media.type === 'image' ? (
                  <img
                    src={media.preview}
                    alt={`Preview ${index + 1}`}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="relative w-full h-full">
                    <video
                      src={media.preview}
                      className="w-full h-full object-cover"
                      muted
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <div className="p-2 rounded-full bg-white/20 backdrop-blur-sm">
                        <Film className="h-5 w-5 text-white" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Type badge */}
                <div className={cn(
                  'absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider',
                  media.type === 'image'
                    ? 'bg-blue-500/90 text-white'
                    : 'bg-purple-500/90 text-white'
                )}>
                  {media.type === 'image' ? 'Foto' : 'Vídeo'}
                </div>

                {/* First image = principal */}
                {index === 0 && media.type === 'image' && existingPhotosCount === 0 && (
                  <div className="absolute top-1.5 right-8 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary text-primary-foreground">
                    Principal
                  </div>
                )}

                {/* File size */}
                <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] bg-black/60 text-white backdrop-blur-sm">
                  {formatFileSize(media.file.size)}
                </div>

                {/* Upload progress overlay */}
                {media.status === 'uploading' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="text-center">
                      <Loader2 className="h-5 w-5 text-white animate-spin mx-auto mb-1" />
                      <span className="text-[10px] text-white font-medium">{media.progress}%</span>
                    </div>
                  </div>
                )}

                {/* Done overlay */}
                {media.status === 'done' && (
                  <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center animate-in fade-in duration-300">
                    <CheckCircle2 className="h-6 w-6 text-green-500" />
                  </div>
                )}

                {/* Remove button */}
                {!uploading && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(media.id);
                    }}
                    className="absolute -top-1 -right-1 p-1 bg-destructive text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg hover:scale-110 z-10"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <p>
              {imageCount > 0 && `${imageCount} foto(s)`}
              {imageCount > 0 && videoCount > 0 && ' • '}
              {videoCount > 0 && `${videoCount} vídeo(s)`}
              {' '}selecionado(s)
              {imageCount > 0 && existingPhotosCount === 0 && ' • A primeira foto será a principal'}
            </p>
            {mediaFiles.length > 0 && !uploading && (
              <button
                type="button"
                onClick={() => {
                  mediaFiles.forEach(f => URL.revokeObjectURL(f.preview));
                  setMediaFiles([]);
                  onImagesSelected([]);
                }}
                className="text-destructive hover:text-destructive/80 font-medium transition-colors"
              >
                Limpar tudo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Upload progress bar (global) */}
      {uploading && (
        <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
          <Progress value={uploadedCount > 0 ? (uploadedCount / mediaFiles.length) * 100 : 10} className="h-2" />
          <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            Enviando mídias... {uploadedCount}/{mediaFiles.length}
          </p>
        </div>
      )}

      {/* Info tip */}
      <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg p-3">
        <p className="text-xs text-blue-800 dark:text-blue-200">
          <strong>💡 Sincronização Automática:</strong> As fotos e vídeos enviados aqui serão automaticamente vinculados ao imóvel selecionado. Você também pode gerenciá-los na página do imóvel.
        </p>
      </div>
    </div>
  );
}
