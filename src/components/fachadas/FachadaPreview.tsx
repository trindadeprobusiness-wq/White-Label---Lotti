import { useRef, useEffect, useState } from 'react';
import { Download, Box, Home, Lock, Phone, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QRCodeGenerator } from './QRCodeGenerator';
import { DEFAULT_TEMPLATES, TIPO_NEGOCIO_LABELS, CTA_LABELS } from '@/types/fachada';
import type { FachadaComImovel, TemplateConfig } from '@/types/fachada';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { obterMidiasImovelApi, obterTemplatePorImagemApi } from '@/lib/api/fachadas';
import { getFachadaPublicUrl } from '@/lib/publicBaseUrl';
import { baixarFachadaComQr } from './fachadaExport';
import { toast } from 'sonner';

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

  // QR position from custom template config
  const [customQrPosition, setCustomQrPosition] = useState<{ x: number; y: number } | null>(null);
  const [customQrSize, setCustomQrSize] = useState<number | null>(null);
  const [baixando, setBaixando] = useState(false);
  // Foto do imóvel resolvida SEMPRE ao vivo (fonte única: imovel_fotos)
  const [fotoImovel, setFotoImovel] = useState<string | null>(fachada?.foto_principal_url ?? null);

  const isCustomTemplate = (fachada?.template_id || '').startsWith('http');

  // Resolve a foto principal (ou a primeira) direto de imovel_fotos, para o preview
  // refletir a mídia atual do imóvel, não um snapshot antigo.
  const fotoEmCache = fachada?.foto_principal_url ?? null;
  useEffect(() => {
    const imovelId = fachada?.imovel_id;
    if (!imovelId) {
      setFotoImovel(null);
      return;
    }
    let ativo = true;
    (async () => {
      if (apiDisponivel()) {
        try {
          const r = await obterMidiasImovelApi(imovelId);
          if (ativo) setFotoImovel(r.foto_principal_url ?? fotoEmCache);
        } catch {
          // Silently ignore — mantém a foto que já estava no estado
        }
        return;
      }
      const { data: principal } = await supabase
        .from('imovel_fotos')
        .select('arquivo_url')
        .eq('imovel_id', imovelId)
        .eq('principal', true)
        .maybeSingle();
      let url = principal?.arquivo_url ?? null;
      if (!url) {
        const { data: primeira } = await supabase
          .from('imovel_fotos')
          .select('arquivo_url')
          .eq('imovel_id', imovelId)
          .order('ordem', { ascending: true })
          .limit(1)
          .maybeSingle();
        url = primeira?.arquivo_url ?? null;
      }
      if (ativo) setFotoImovel(url);
    })();
    return () => {
      ativo = false;
    };
  }, [fachada?.imovel_id, fotoEmCache]);

  // Fetch custom template QR position when template is a URL
  useEffect(() => {
    if (!fachada || !isCustomTemplate) {
      setCustomQrPosition(null);
      setCustomQrSize(null);
      return;
    }

    const fetchTemplateConfig = async () => {
      try {
        const data: Record<string, unknown> | null = apiDisponivel()
          ? await obterTemplatePorImagemApi(fachada.template_id)
          : (await supabase
              .from('fachada_templates')
              .select('config')
              .filter('config->>imagem_url', 'eq', fachada.template_id)
              .limit(1)
              .maybeSingle()).data as unknown as Record<string, unknown> | null;

        if (data?.config) {
          const cfg = data.config as any;
          if (cfg.qrPosition) setCustomQrPosition(cfg.qrPosition);
          if (cfg.qrSize) setCustomQrSize(cfg.qrSize);
        }
      } catch {
        // Silently ignore — will use default position
      }
    };

    fetchTemplateConfig();
  }, [fachada?.template_id, isCustomTemplate]);

  if (!fachada) return null;

  const config = getTemplateConfig(fachada.template_id);
  // Sempre aponta para o domínio público — nunca localhost (senão o QR não escaneia).
  const qrUrl = getFachadaPublicUrl(fachada.id);

  const formatPrice = (valor: number) => `R$ ${valor.toLocaleString('pt-BR')}`;

  const handleDownload = async () => {
    // Template personalizado: compõe a arte + QR num PNG único (escaneável). O print
    // com innerHTML perdia o CSS e desgrudava o QR da arte.
    if (isCustomTemplate) {
      setBaixando(true);
      const toastId = toast.loading('Gerando a fachada com o QR...');
      try {
        await baixarFachadaComQr({
          artUrl: fachada.template_id,
          qrValue: qrUrl,
          qrPosition: customQrPosition ?? { x: 50, y: 50 },
          qrSizePercent: customQrSize || 20,
          fileName: `fachada-${(fachada.imovel?.titulo || 'imovel').replace(/[^\w-]+/g, '_').slice(0, 40)}.png`,
        });
        toast.success('Fachada baixada! O QR já está na arte, pronto para imprimir.', { id: toastId });
      } catch (err: any) {
        toast.error('Não foi possível gerar a imagem: ' + (err?.message ?? 'erro'), { id: toastId });
      } finally {
        setBaixando(false);
      }
      return;
    }

    // Templates padrão (HTML/CSS): mantém a impressão.
    const content = previewRef.current;
    if (!content) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Fachada</title>
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
    printWindow.document.title = `Fachada - ${fachada.imovel?.titulo ?? ''}`;
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
          {fachada.template_id === 'oliver-premium' ? (
            <OliverPremiumLayout fachada={fachada} qrUrl={qrUrl} />
          ) : isCustomTemplate ? (
            /* ─── Custom Template: Arte + QR posicionado ─── */
            <div
              className="rounded-xl overflow-hidden shadow-2xl mx-auto relative"
              style={{ maxWidth: 420 }}
            >
              <img
                src={fachada.template_id}
                alt="Fachada"
                className="w-full object-contain"
                style={{ display: 'block' }}
              />
              {/* QR Code real posicionado — desenhado direto no tamanho escolhido.
                  O PNG do QR já tem fundo branco + zona de silêncio, então não precisa
                  de caixa branca extra (que só deixava o QR pequeno dentro da arte). */}
              <div
                className="absolute z-20"
                style={{
                  left: `${customQrPosition?.x ?? 50}%`,
                  top: `${customQrPosition?.y ?? 50}%`,
                  transform: 'translate(-50%, -50%)',
                  width: `${customQrSize || 45}%`,
                  aspectRatio: '1',
                }}
              >
                <QRCodeGenerator value={qrUrl} size={512} className="w-full h-full" />
              </div>
            </div>
          ) : (
            /* ─── Template Padrão ─── */
            <div
              className="rounded-xl overflow-hidden shadow-2xl mx-auto relative"
              style={{
                maxWidth: 420,
                background: `linear-gradient(135deg, ${config.corFundo}, ${config.corPrimaria})`,
                color: config.corTexto,
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
            <div className="relative z-10 h-full flex flex-col justify-between">
              {/* Header com tipo */}
              <div
                className="px-6 py-4 text-center"
                style={{ borderBottom: `3px solid ${config.corSecundaria}30` }}
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

            {/* Foto do imóvel (ao vivo de imovel_fotos) */}
            {fotoImovel && (
              <div className="h-44 overflow-hidden">
                <img
                  src={fotoImovel}
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

              {/* Footer — dados do corretor */}
              <div
                className="px-6 py-3 text-center text-xs opacity-90 font-medium"
                style={{ borderTop: `1px solid ${config.corTexto}20` }}
              >
                <p className="font-semibold text-sm">
                  {fachada.corretor?.razao_social ?? fachada.corretor?.nome}
                </p>
                <p>{fachada.corretor?.telefone}</p>
                <p>CRECI {fachada.corretor?.creci}</p>
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Botões */}
        <div className="flex gap-3 pt-4">
          <Button className="flex-1" onClick={handleDownload} disabled={baixando}>
            {baixando ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {isCustomTemplate ? 'Baixar imagem (PNG)' : 'Baixar / Imprimir PDF'}
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

function OliverPremiumLayout({ fachada, qrUrl }: { fachada: FachadaComImovel; qrUrl: string }) {
  const corretorTelefone = fachada.corretor?.telefone || '62 9407-2862';

  return (
    <div
      className="mx-auto relative flex flex-col items-center bg-black text-[#d4af37]"
      style={{
        width: '420px',
        minHeight: '740px',
        border: '2px solid #d4af37',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top Logo */}
      <div className="mt-8 flex flex-col items-center">
        {/* Placeholder for the Oliver Logo */}
        <div className="w-16 h-16 rounded-full border-2 border-[#d4af37] flex items-center justify-center mb-2">
           <svg className="w-8 h-8 text-[#d4af37]" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2zm0 4.5l6.5 13.5h-13L12 6.5z"/></svg>
        </div>
        <h1 className="text-3xl tracking-widest font-serif" style={{ fontFamily: 'Times New Roman, serif' }}>OLIVER</h1>
        <p className="text-[10px] tracking-[0.3em] font-light mt-1">NEGÓCIOS INTELIGENTES</p>
      </div>

      {/* Decorative line */}
      <div className="flex items-center w-64 my-6 opacity-60">
        <div className="flex-1 border-t border-[#d4af37]"></div>
        <div className="mx-2 rotate-45 w-2 h-2 bg-[#d4af37]"></div>
        <div className="flex-1 border-t border-[#d4af37]"></div>
      </div>

      {/* Call to action text */}
      <div className="text-center space-y-1">
        <p className="text-xs tracking-widest font-semibold">ESCANEIE E DESCUBRA</p>
        <p className="text-2xl font-bold text-white tracking-wide">VEJA ESSE IMÓVEL</p>
        <p className="text-3xl font-bold text-[#d4af37] tracking-wide">POR DENTRO</p>
      </div>

      {/* QR Code */}
      <div className="mt-8 bg-white p-2 rounded-xl border-4 border-[#d4af37]">
        <QRCodeGenerator value={qrUrl} size={180} />
      </div>

      {/* 3 Icons */}
      <div className="flex justify-between w-full px-8 mt-10">
        <div className="flex flex-col items-center text-center w-24">
          <Box className="w-6 h-6 mb-2" strokeWidth={1.5} />
          <p className="text-[8px] font-semibold leading-tight">TOUR VIRTUAL EXCLUSIVO</p>
        </div>
        <div className="w-px h-10 bg-[#d4af37]/30"></div>
        <div className="flex flex-col items-center text-center w-24">
          <Home className="w-6 h-6 mb-2" strokeWidth={1.5} />
          <p className="text-[8px] font-semibold leading-tight">ACESSE TODOS OS DETALHES</p>
        </div>
        <div className="w-px h-10 bg-[#d4af37]/30"></div>
        <div className="flex flex-col items-center text-center w-24">
          <Lock className="w-6 h-6 mb-2" strokeWidth={1.5} />
          <p className="text-[8px] font-semibold leading-tight">INFORMAÇÕES EXCLUSIVAS</p>
        </div>
      </div>

      {/* Spacer to push skyline to bottom */}
      <div className="flex-grow"></div>

      {/* Skyline & Phone */}
      <div className="w-full flex flex-col items-center mt-6">
        <div className="flex items-center w-3/4 mb-2 opacity-60">
           <div className="flex-1 border-t border-[#d4af37]"></div>
           <div className="mx-2 rotate-45 w-2 h-2 bg-[#d4af37]"></div>
           <div className="flex-1 border-t border-[#d4af37]"></div>
        </div>
        
        {/* Simple skyline SVG placeholder */}
        <div className="w-full px-8 opacity-80 flex justify-center items-end h-16">
           <svg viewBox="0 0 100 20" className="w-full h-full text-[#d4af37]" fill="currentColor" preserveAspectRatio="none">
              <path d="M0,20 L0,15 L5,15 L5,10 L10,10 L10,18 L15,18 L15,8 L20,8 L20,13 L25,13 L25,5 L30,5 L30,17 L35,17 L35,12 L40,12 L40,7 L45,7 L45,19 L50,19 L50,3 L55,3 L55,16 L60,16 L60,9 L65,9 L65,15 L70,15 L70,6 L75,6 L75,14 L80,14 L80,11 L85,11 L85,18 L90,18 L90,8 L95,8 L95,15 L100,15 L100,20 Z" />
           </svg>
        </div>
        <div className="w-full border-t border-[#d4af37]/50 mt-1 mb-4"></div>

        <div className="flex items-center justify-center gap-3 mb-6">
          <Phone className="w-6 h-6 text-[#d4af37]" />
          <p className="text-3xl font-bold tracking-wider">{corretorTelefone}</p>
        </div>
      </div>
    </div>
  );
}
