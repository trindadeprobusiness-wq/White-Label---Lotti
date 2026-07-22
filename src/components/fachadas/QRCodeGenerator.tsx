import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeGeneratorProps {
  value: string;
  size?: number;
  className?: string;
}

// Opções padrão: alta correção de erro (H) — o QR continua escaneável mesmo com
// um logo/moldura por cima — e uma zona de silêncio (margin) para leitura confiável.
const QR_OPTIONS = {
  errorCorrectionLevel: 'H' as const,
  margin: 2,
  color: { dark: '#000000', light: '#ffffff' },
};

/**
 * Gera o QR Code LOCALMENTE (lib `qrcode`), sem depender de nenhum serviço externo.
 * Antes usava api.qrserver.com — um serviço de terceiros lento e que, quando ficava
 * fora do ar/bloqueado, fazia o QR "não aparecer". Agora é instantâneo e 100% confiável.
 */
export function QRCodeGenerator({ value, size = 200, className }: QRCodeGeneratorProps) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { ...QR_OPTIONS, width: Math.max(size, 320) })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch((err) => {
        console.error('Falha ao gerar QR Code:', err);
        if (!cancelled) setDataUrl('');
      });
    return () => { cancelled = true; };
  }, [value, size]);

  if (!dataUrl) {
    // Placeholder neutro enquanto gera (na prática, instantâneo).
    return (
      <div
        style={{ width: size, height: size }}
        className={className}
        aria-label="Gerando QR Code"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt="QR Code"
      width={size}
      height={size}
      className={className}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

/**
 * Gera o QR Code como Data URL (PNG) — usado no compositor da fachada (canvas) e
 * em downloads. Também 100% local via lib `qrcode` (o data URL é same-origin, então
 * não "tinta" o canvas na hora de exportar a imagem).
 */
export async function generateQRCodeDataURL(
  value: string,
  size = 400,
): Promise<string> {
  return QRCode.toDataURL(value, { ...QR_OPTIONS, width: size });
}
