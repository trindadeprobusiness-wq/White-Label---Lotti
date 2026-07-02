import { useState } from 'react';
import { Play, MoreVertical, Pencil, Trash2, Link2, Eye, Building2, Video, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { VideoRow, TipoVideo } from '@/hooks/useVideos';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

interface VideoCardProps {
  video: VideoRow;
  imovelNome?: string;
  onPlay: (video: VideoRow) => void;
  onEdit: (video: VideoRow) => void;
  onDelete: (video: VideoRow) => void;
  onShare: (video: VideoRow) => void;
}

const TIPO_LABELS: Record<TipoVideo, string> = {
  TOUR_VIRTUAL: 'Tour Virtual',
  APRESENTACAO: 'Apresentação',
  DEPOIMENTO: 'Depoimento',
  DRONE: 'Drone/Aéreo',
  INSTITUCIONAL: 'Institucional',
  OUTRO: 'Outro',
};

const TIPO_CORES: Record<TipoVideo, string> = {
  TOUR_VIRTUAL: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  APRESENTACAO: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  DEPOIMENTO: 'bg-green-500/10 text-green-700 dark:text-green-400',
  DRONE: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  INSTITUCIONAL: 'bg-pink-500/10 text-pink-700 dark:text-pink-400',
  OUTRO: 'bg-muted text-muted-foreground',
};

export function VideoCard({ video, imovelNome, onPlay, onEdit, onDelete, onShare }: VideoCardProps) {
  const [imageError, setImageError] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(video.video_url);
    toast.success('Link copiado!');
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return null;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Card className="overflow-hidden group hover:shadow-lg transition-shadow">
      {/* Thumbnail / Preview */}
      <div 
        className="relative aspect-video bg-muted cursor-pointer"
        onClick={() => onPlay(video)}
      >
        {video.thumbnail_url && !imageError ? (
          <img
            src={video.thumbnail_url}
            alt={video.titulo}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/10">
            <Video className="h-12 w-12 text-muted-foreground/50" />
          </div>
        )}

        {/* Play Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="h-14 w-14 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="h-6 w-6 text-primary fill-primary ml-1" />
          </div>
        </div>

        {/* Duration Badge */}
        {video.duracao_segundos && (
          <Badge variant="secondary" className="absolute bottom-2 right-2 text-xs">
            {formatDuration(video.duracao_segundos)}
          </Badge>
        )}

        {/* Type Badge */}
        <Badge className={`absolute top-2 left-2 ${TIPO_CORES[video.tipo]}`}>
          {TIPO_LABELS[video.tipo]}
        </Badge>
      </div>

      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate" title={video.titulo}>
              {video.titulo}
            </h4>
            
            {imovelNome && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <Building2 className="h-3 w-3" />
                <span className="truncate">{imovelNome}</span>
              </p>
            )}

            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {video.visualizacoes}
              </span>
              <span>
                {formatDistanceToNow(new Date(video.created_at), { 
                  addSuffix: true, 
                  locale: ptBR 
                })}
              </span>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onPlay(video)}>
                <Play className="h-4 w-4 mr-2" />
                Reproduzir
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyLink}>
                <Link2 className="h-4 w-4 mr-2" />
                Copiar Link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onShare(video)}>
                <Share2 className="h-4 w-4 mr-2" />
                Compartilhar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onEdit(video)}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onDelete(video)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
