import { useState } from 'react';
import { X, Star, Trash2, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ImovelFoto } from '@/hooks/useImovelFotos';

interface ImovelGaleriaProps {
  fotos: ImovelFoto[];
  onDelete?: (id: string, path: string) => void;
  onSetPrincipal?: (id: string) => void;
  readonly?: boolean;
}

export function ImovelGaleria({ 
  fotos, 
  onDelete, 
  onSetPrincipal,
  readonly = false 
}: ImovelGaleriaProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const openLightbox = (index: number) => {
    setCurrentIndex(index);
    setLightboxOpen(true);
  };

  const nextImage = () => {
    setCurrentIndex((prev) => (prev + 1) % fotos.length);
  };

  const prevImage = () => {
    setCurrentIndex((prev) => (prev - 1 + fotos.length) % fotos.length);
  };

  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (fotos.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Nenhuma foto cadastrada
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {fotos.map((foto, index) => (
          <div 
            key={foto.id} 
            className="relative group aspect-square cursor-pointer"
            onClick={() => openLightbox(index)}
          >
            <img
              src={foto.arquivo_url}
              alt={`Foto ${index + 1}`}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover rounded-lg"
            />
            {foto.principal && (
              <div className="absolute top-2 left-2 p-1.5 bg-primary rounded-full">
                <Star className="w-3 h-3 text-primary-foreground" />
              </div>
            )}
            {!readonly && (
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                {!foto.principal && onSetPrincipal && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetPrincipal(foto.id);
                    }}
                  >
                    <Star className="w-4 h-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(foto.id, foto.arquivo_path);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-4xl p-0 bg-black/95 border-none">
          <div className="relative">
            <img
              src={fotos[currentIndex]?.arquivo_url}
              alt={`Foto ${currentIndex + 1}`}
              className="w-full max-h-[80vh] object-contain"
            />
            
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 text-white hover:bg-white/20"
              onClick={() => setLightboxOpen(false)}
            >
              <X className="w-5 h-5" />
            </Button>

            {fotos.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    prevImage();
                  }}
                >
                  <ChevronLeft className="w-6 h-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    nextImage();
                  }}
                >
                  <ChevronRight className="w-6 h-6" />
                </Button>
              </>
            )}

            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4">
              <span className="text-white text-sm">
                {currentIndex + 1} / {fotos.length}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleDownload(
                  fotos[currentIndex]?.arquivo_url,
                  `foto-${currentIndex + 1}.jpg`
                )}
              >
                <Download className="w-4 h-4 mr-1" />
                Download
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
