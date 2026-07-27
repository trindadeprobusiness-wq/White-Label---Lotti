import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, X, Image, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FilePreview {
  file: File;
  preview: string;
}

interface ImovelFotosUploadProps {
  onFilesSelected: (files: File[]) => void;
  uploading?: boolean;
  maxFiles?: number;
  mode?: 'automatic' | 'manual';
}

export function ImovelFotosUpload({
  onFilesSelected,
  uploading = false,
  maxFiles = 50,
  mode = 'automatic'
}: ImovelFotosUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Notify parent whenever previews change (ONLY in automatic mode)
  useEffect(() => {
    if (mode === 'automatic') {
      onFilesSelected(previews.map(p => p.file));
    }
  }, [previews, onFilesSelected, mode]);

  const validateFile = (file: File): boolean => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      return false;
    }
    return true;
  };

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(validateFile).slice(0, maxFiles - previews.length);

    if (validFiles.length === 0) return;

    const newPreviews = validFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setPreviews(prev => [...prev, ...newPreviews]);
  }, [previews.length, maxFiles]);

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
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const removePreview = (index: number) => {
    setPreviews(prev => {
      const newPreviews = [...prev];
      URL.revokeObjectURL(newPreviews[index].preview);
      newPreviews.splice(index, 1);
      return newPreviews;
    });
  };

  const handleManualUpload = () => {
    if (previews.length > 0) {
      onFilesSelected(previews.map(p => p.file));
      // Clear previews after upload starts
      previews.forEach(p => URL.revokeObjectURL(p.preview));
      setPreviews([]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
          uploading && 'pointer-events-none opacity-50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleChange}
          className="hidden"
          disabled={uploading}
        />
        <div className="flex flex-col items-center gap-2">
          <div className="p-3 rounded-full bg-primary/10">
            <Image className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="font-medium">Arraste fotos ou clique para selecionar</p>
            <p className="text-sm text-muted-foreground">
              JPEG, PNG ou WebP (máx. 5MB cada, até {maxFiles} fotos)
            </p>
          </div>
        </div>
      </div>

      {/* Previews */}
      {previews.length > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {previews.map((preview, index) => (
              <div key={index} className="relative group aspect-square">
                <img
                  src={preview.preview}
                  alt={`Preview ${index + 1}`}
                  className="w-full h-full object-cover rounded-lg"
                />
                {index === 0 && (
                  <div className="absolute top-1 left-1 p-1 bg-primary rounded-full">
                    <Star className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removePreview(index);
                  }}
                  className="absolute -top-2 -right-2 p-1 bg-destructive text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {previews.length} foto(s) selecionada(s) • A primeira será a foto principal
            </p>
            {mode === 'manual' && (
              <Button onClick={handleManualUpload} disabled={uploading}>
                {uploading ? (
                  <>
                    <Upload className="w-4 h-4 mr-2 animate-pulse" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Enviar Fotos
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
