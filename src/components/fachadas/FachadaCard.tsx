import { Eye, QrCode, Users, MoreVertical, Power, Trash2 } from 'lucide-react';
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

interface FachadaCardProps {
  fachada: FachadaComImovel;
  onPreview: (f: FachadaComImovel) => void;
  onDeactivate: (id: string) => void;
}

export function FachadaCard({ fachada, onPreview, onDeactivate }: FachadaCardProps) {
  const taxa =
    fachada.total_escaneamentos > 0
      ? Math.round((fachada.total_leads / fachada.total_escaneamentos) * 100)
      : 0;

  const baseUrl = window.location.origin;
  const qrUrl = `${baseUrl}/p/${fachada.id}`;

  return (
    <Card className="hover:shadow-lg transition-all duration-300 overflow-hidden group">
      {/* Header visual */}
      <div className="h-28 relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5">
        {fachada.foto_principal_url ? (
          <img
            src={fachada.foto_principal_url}
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
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDeactivate(fachada.id)}
              >
                <Power className="h-4 w-4 mr-2" /> Desativar
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

        {/* CTA info */}
        <p className="text-xs text-muted-foreground">
          CTA: {CTA_LABELS[fachada.cta_principal]}
        </p>

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
