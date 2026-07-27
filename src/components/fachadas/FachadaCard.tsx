import { useState, useEffect } from 'react';
import { Eye, QrCode, MoreVertical, Trash2, Pencil, Image, Film } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TIPO_NEGOCIO_LABELS, CTA_LABELS } from '@/types/fachada';
import type { FachadaComImovel } from '@/types/fachada';
import { getFachadaPublicUrl } from '@/lib/publicBaseUrl';
import { supabase } from '@/integrations/supabase/client';

interface FachadaCardProps {
  fachada: FachadaComImovel;
  onPreview: (f: FachadaComImovel) => void;
  onEdit: (f: FachadaComImovel) => void;
  onDeactivate: (id: string) => void;
}

export function FachadaCard({ fachada, onPreview, onEdit, onDeactivate }: FachadaCardProps) {
  const [fotoPrincipal, setFotoPrincipal] = useState<string | null>(fachada.foto_principal_url || null);
  const [mediaCounts, setMediaCounts] = useState({ fotos: 0, videos: 0 });

  useEffect(() => {
    const fetchMedia = async () => {
      if (!fachada.imovel_id) return;

      // Resolve a foto principal SEMPRE ao vivo — imovel_fotos é a fonte única; o
      // cache fachada.foto_principal_url pode estar desatualizado após editar o imóvel.
      const { data: principal } = await supabase
        .from('imovel_fotos')
        .select('arquivo_url')
        .eq('imovel_id', fachada.imovel_id)
        .eq('principal', true)
        .maybeSingle();
      if (principal?.arquivo_url) {
        setFotoPrincipal(principal.arquivo_url);
      } else {
        // Sem principal definida: usa a primeira foto (por ordem).
        const { data: primeira } = await supabase
          .from('imovel_fotos')
          .select('arquivo_url')
          .eq('imovel_id', fachada.imovel_id)
          .order('ordem', { ascending: true })
          .limit(1)
          .maybeSingle();
        setFotoPrincipal(primeira?.arquivo_url ?? null);
      }

      // Count media
      const { count: fotosCount } = await supabase
        .from('imovel_fotos')
        .select('id', { count: 'exact', head: true })
        .eq('imovel_id', fachada.imovel_id);
      const { count: videosCount } = await supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .eq('imovel_id', fachada.imovel_id);

      setMediaCounts({ fotos: fotosCount || 0, videos: videosCount || 0 });
    };
    fetchMedia();
  }, [fachada.imovel_id]);

  const taxa =
    fachada.total_escaneamentos > 0
      ? Math.round((fachada.total_leads / fachada.total_escaneamentos) * 100)
      : 0;

  const qrUrl = getFachadaPublicUrl(fachada.id);
  const hasMidias = mediaCounts.fotos > 0 || mediaCounts.videos > 0;

  return (
    <Card className="hover:shadow-lg transition-all duration-300 overflow-hidden group">
      {/* Header visual */}
      <div className="h-28 relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5">
        {fotoPrincipal ? (
          <img
            src={fotoPrincipal}
            alt=""
            className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-500"
          />
        ) : null}
        <div className="absolute inset-0 flex items-center justify-center">
          <QrCode className="h-12 w-12 text-primary/30" />
        </div>

        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <Badge variant="secondary" className="text-[10px] backdrop-blur-sm bg-background/80">
            {TIPO_NEGOCIO_LABELS[fachada.tipo_negocio]}
          </Badge>
          {fachada.modo_conversao && (
            <Badge className="text-[10px] bg-amber-500/90 hover:bg-amber-500 text-white">
              ⚡ Conversão
            </Badge>
          )}
        </div>

        {/* Menu */}
        <div className="absolute top-2 right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onPreview(fachada)}>
                <Eye className="h-4 w-4 mr-2" /> Ver Preview
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(qrUrl, '_blank')}>
                <QrCode className="h-4 w-4 mr-2" /> Abrir Landing Page
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(fachada)}>
                <Pencil className="h-4 w-4 mr-2" /> Editar Fachada
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDeactivate(fachada.id)}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CardContent className="p-4 space-y-3">
        {/* Título do imóvel */}
        <div>
          <h3 className="font-semibold text-sm line-clamp-1">
            {fachada.imovel?.titulo ?? 'Imóvel'}
          </h3>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {fachada.imovel?.endereco} — {fachada.imovel?.bairro}
          </p>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/50 rounded-lg p-2">
            <p className="text-lg font-bold">{fachada.total_escaneamentos}</p>
            <p className="text-[10px] text-muted-foreground">Scans</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <p className="text-lg font-bold">{fachada.total_leads}</p>
            <p className="text-[10px] text-muted-foreground">Leads</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <p className="text-lg font-bold">{taxa}%</p>
            <p className="text-[10px] text-muted-foreground">Conversão</p>
          </div>
        </div>

        {/* CTA + Media info */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            CTA: {CTA_LABELS[fachada.cta_principal]}
          </p>
          {hasMidias && (
            <div className="flex items-center gap-2">
              {mediaCounts.fotos > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <Image className="h-3 w-3" /> {mediaCounts.fotos}
                </span>
              )}
              {mediaCounts.videos > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <Film className="h-3 w-3" /> {mediaCounts.videos}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Ação principal */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onPreview(fachada)}
        >
          <Eye className="h-4 w-4 mr-2" /> Ver & Baixar PDF
        </Button>
      </CardContent>
    </Card>
  );
}
