import { useState, useEffect } from 'react';
import {
  Eye, QrCode, MoreVertical, Trash2, Pencil, Image, Film, MapPin,
  Link as LinkIcon, ChevronRight, Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
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
import { QRCodeGenerator } from './QRCodeGenerator';
import { StatusBadge } from '@/components/shell/primitivos';

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
      const { data: fotos } = await supabase
        .from('imovel_fotos')
        .select('arquivo_url, principal, ordem')
        .eq('imovel_id', fachada.imovel_id)
        .order('principal', { ascending: false })
        .order('ordem', { ascending: true })
        .limit(1);

      if (fotos && fotos.length > 0) {
        setFotoPrincipal(fotos[0].arquivo_url);
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

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(qrUrl);
      toast.success('Link copiado.');
    } catch {
      // clipboard exige contexto seguro (https) e pode ser negado.
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  };

  return (
    // Layout horizontal: imagem | dados | QR. O card antigo empilhava tudo em
    // coluna e mostrava, no lugar do QR, um ícone genérico do lucide — idêntico
    // em todas as fachadas. O QR real ficava a dois cliques, dentro de um
    // dialog. Aqui ele é a terceira coluna, visível de imediato.
    <Card className="overflow-hidden transition-shadow duration-150 hover:shadow-card-hover">
      <div className="flex flex-col lg:flex-row">
        {/* Imagem do imóvel */}
        <div className="relative h-48 shrink-0 overflow-hidden bg-muted lg:h-auto lg:w-64">
          {fotoPrincipal ? (
            <img src={fotoPrincipal} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface-brand">
              <Building2 className="h-10 w-10 text-primary/40" />
            </div>
          )}

          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-background/90 text-[11px] backdrop-blur-sm">
              {TIPO_NEGOCIO_LABELS[fachada.tipo_negocio]}
            </Badge>
            {fachada.modo_conversao && (
              <Badge className="bg-warning text-[11px] text-warning-foreground hover:bg-warning">
                Em conversão
              </Badge>
            )}
          </div>
        </div>

        {/* Dados e ações */}
        <div className="min-w-0 flex-1 p-5">
          <h3 className="truncate text-card-title text-foreground">
            {fachada.imovel?.titulo ?? 'Imóvel'}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {[fachada.imovel?.endereco, fachada.imovel?.bairro].filter(Boolean).join(', ') ||
              'Sem endereço'}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge tom={fachada.ativo ? 'success' : 'neutro'} comPonto>
              {fachada.ativo ? 'Ativa' : 'Inativa'}
            </StatusBadge>
            <span className="text-sm text-muted-foreground">
              CTA: {CTA_LABELS[fachada.cta_principal]}
            </span>
            {hasMidias && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {mediaCounts.fotos > 0 && (
                  <span className="flex items-center gap-1">
                    <Image className="h-3.5 w-3.5" />
                    {mediaCounts.fotos}
                  </span>
                )}
                {mediaCounts.videos > 0 && (
                  <span className="flex items-center gap-1">
                    <Film className="h-3.5 w-3.5" />
                    {mediaCounts.videos}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Métricas em faixa com divisores: os três números são lidos em
              conjunto (19 leituras → 9 leads → 47%), não isoladamente. */}
          <div className="mt-4 grid grid-cols-3 rounded-lg border border-border">
            <div className="p-3 text-center">
              <p className="text-xl font-semibold tabular text-foreground">
                {fachada.total_escaneamentos}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">leituras</p>
            </div>
            <div className="border-x border-border p-3 text-center">
              <p className="text-xl font-semibold tabular text-foreground">
                {fachada.total_leads}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">leads</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-xl font-semibold tabular text-foreground">{taxa}%</p>
              <p className="mt-0.5 text-xs text-muted-foreground">conversão</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => onPreview(fachada)}>
              <Eye className="mr-2 h-4 w-4" />
              Ver e baixar PDF
            </Button>
            <Button variant="outline" onClick={() => onEdit(fachada)}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Mais ações">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => window.open(qrUrl, '_blank')}>
                  <QrCode className="mr-2 h-4 w-4" /> Abrir landing page
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void copiarLink()}>
                  <LinkIcon className="mr-2 h-4 w-4" /> Copiar link
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDeactivate(fachada.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* QR real, gerado da URL desta fachada pelo QRCodeGenerator que já
            existia e não era usado aqui. */}
        <div className="flex shrink-0 flex-col items-center gap-3 border-t border-border p-5 lg:w-60 lg:border-l lg:border-t-0">
          <p className="self-start text-sm font-medium text-foreground">QR Code em atividade</p>
          {/* QR e texto empilhados: lado a lado, a explicação ficava com ~10
              caracteres por linha na coluna de 240px e virava um bloco ilegível. */}
          <div className="rounded-lg border border-border bg-white p-2">
            <QRCodeGenerator value={qrUrl} size={112} />
          </div>
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Use o PDF na placa do imóvel para captar contatos automaticamente.
          </p>
          <Button variant="outline" size="sm" className="w-full" onClick={() => void copiarLink()}>
            <LinkIcon className="mr-2 h-4 w-4" />
            Copiar link
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => onPreview(fachada)}>
            Ver leads
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
