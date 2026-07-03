import { useRef } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QRCodeGenerator } from './QRCodeGenerator';
import { DEFAULT_TEMPLATES, TIPO_NEGOCIO_LABELS, CTA_LABELS } from '@/types/fachada';
import type { FachadaComImovel, TemplateConfig } from '@/types/fachada';

interface FachadaPreviewProps {
  fachada: FachadaComImovel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getTemplateConfig(templateId: string): TemplateConfig {
  const found = DEFAULT_TEMPLATES.find(
    (t) => t.nome.toLowerCase().replace(/\s+/g, '-') === templateId,
  );
  return (
    found?.config ?? {
      corPrimaria: '#1e40af',
      corSecundaria: '#ffffff',
      corTexto: '#ffffff',
      corFundo: '#1e3a5f',
      estilo: 'classico' as const,
      layout: 'vertical' as const,
    }
  );
}

export function FachadaPreview({ fachada, open, onOpenChange }: FachadaPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);

  if (!fachada) return null;

  const config = getTemplateConfig(fachada.template_id);
  const baseUrl = window.location.origin;
  const qrUrl = `${baseUrl}/p/${fachada.id}`;

  const formatPrice = (valor: number) => `R$ ${valor.toLocaleString('pt-BR')}`;

  const handleDownload = () => {
    // Simple approach: open print dialog for the preview
    const content = previewRef.current;
    if (!content) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Fachada - ${fachada.imovel?.titulo}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f5f5f5; }
            @media print { body { background: white; } }
          </style>
        </head>
        <body>${content.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview da Fachada</DialogTitle>
        </DialogHeader>

        {/* Preview visual */}
        <div ref={previewRef}>
          <div
            className="rounded-xl overflow-hidden shadow-2xl mx-auto relative"
            style={{
              maxWidth: 420,
              background: (fachada.template_id || '').startsWith('http')
                ? `url(${fachada.template_id}) center/cover no-repeat`
                : `linear-gradient(135deg, ${config.corFundo}, ${config.corPrimaria})`,
              color: config.corTexto,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              minHeight: (fachada.template_id || '').startsWith('http') ? '600px' : 'auto',
            }}
          >
            {/* Opcional: overlay escuro para garantir leitura caso a imagem de fundo seja clara */}
            {(fachada.template_id || '').startsWith('http') && (
              <div className="absolute inset-0 bg-black/40 z-0"></div>
            )}
            
            <div className="relative z-10 h-full flex flex-col justify-between">
              {/* Header com tipo */}
              <div
                className="px-6 py-4 text-center"
                style={{ borderBottom: (fachada.template_id || '').startsWith('http') ? 'none' : `3px solid ${config.corSecundaria}30` }}
              >
                <span
                  className="text-xs font-bold uppercase tracking-[0.2em] px-4 py-1 rounded-full shadow-md"
                  style={{
                    background: config.corSecundaria,
                    color: config.corPrimaria,
                  }}
                >
                  {TIPO_NEGOCIO_LABELS[fachada.tipo_negocio]}
                </span>
              </div>

            {/* Foto do imóvel */}
            {fachada.foto_principal_url && (
              <div className="h-44 overflow-hidden">
                <img
                  src={fachada.foto_principal_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Informações do imóvel */}
            <div className="px-6 py-5 space-y-3 text-center">
              <h2 className="text-xl font-bold leading-tight">
                {fachada.imovel?.titulo}
              </h2>

              <p className="text-3xl font-extrabold">
                {fachada.imovel?.valor
                  ? formatPrice(fachada.imovel.valor)
                  : ''}
              </p>

              <div className="flex justify-center gap-4 text-sm opacity-80">
                {fachada.imovel?.area_m2 && (
                  <span>{fachada.imovel.area_m2}m²</span>
                )}
                {fachada.imovel?.dormitorios != null && (
                  <span>{fachada.imovel.dormitorios} quartos</span>
                )}
                {fachada.imovel?.garagem != null && (
                  <span>{fachada.imovel.garagem} vagas</span>
                )}
              </div>

              <p className="text-xs opacity-60">
                {fachada.imovel?.endereco} — {fachada.imovel?.bairro},{' '}
                {fachada.imovel?.cidade}
              </p>
            </div>

              <div className="flex flex-col items-center pb-4 mt-auto">
                <div className="bg-white rounded-xl p-3 shadow-lg">
                  <QRCodeGenerator value={qrUrl} size={140} />
                </div>
                <p className="text-[10px] mt-2 font-bold drop-shadow-md text-white">
                  Escaneie para mais informações
                </p>
              </div>

              {/* CTA */}
              {!(fachada.template_id || '').startsWith('http') && (
                <div
                  className="px-6 py-3 text-center"
                  style={{
                    background: config.corSecundaria,
                    color: config.corPrimaria,
                  }}
                >
                  <p className="text-sm font-bold">
                    {CTA_LABELS[fachada.cta_principal]}
                  </p>
                </div>
              )}

              {/* Footer — dados do corretor */}
              <div
                className="px-6 py-3 text-center text-xs opacity-90 text-white font-medium"
                style={{ borderTop: (fachada.template_id || '').startsWith('http') ? 'none' : `1px solid ${config.corTexto}20` }}
              >
                <p className="font-semibold text-sm drop-shadow-md">
                  {fachada.corretor?.razao_social ?? fachada.corretor?.nome}
                </p>
                <p className="drop-shadow-md">{fachada.corretor?.telefone}</p>
                <p className="drop-shadow-md">CRECI {fachada.corretor?.creci}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Botões */}
        <div className="flex gap-3 pt-4">
          <Button className="flex-1" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" /> Baixar / Imprimir PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open(qrUrl, '_blank')}
          >
            Abrir Landing Page
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
