// Exporta a fachada de template personalizado como PNG com o QR "queimado" na arte.
//
// POR QUE existe: o download antigo abria uma janela de impressão com
// `document.write(innerHTML)` SEM CSS. No template personalizado o QR é posicionado
// por classe Tailwind (`.absolute`), que some sem CSS — então o QR desgrudava da
// arte no material impresso. Aqui a composição é feita por CANVAS (mesmo padrão do
// watermark em FotosIA.tsx): a arte + o QR viram uma imagem única e escaneável.

import { generateQRCodeDataURL } from './QRCodeGenerator';

function loadImage(src: string, crossOrigin?: 'anonymous'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem: ' + src));
    img.src = src;
  });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

interface ComposeOptions {
  /** URL da arte (template personalizado). Bucket público do Supabase manda CORS. */
  artUrl: string;
  /** Valor que o QR codifica (a URL pública da fachada). */
  qrValue: string;
  /** Posição do centro do QR em %, relativa à arte. */
  qrPosition: { x: number; y: number };
  /** Largura do QR em % da largura da arte. */
  qrSizePercent: number;
  /** Nome do arquivo baixado. */
  fileName?: string;
}

/**
 * Compõe a arte + QR num canvas e dispara o download do PNG.
 * Lança erro se a arte não puder ser carregada de forma CORS-limpa.
 */
export async function baixarFachadaComQr({
  artUrl,
  qrValue,
  qrPosition,
  qrSizePercent,
  fileName = 'fachada.png',
}: ComposeOptions): Promise<void> {
  // 1. Carrega a arte (CORS anônimo para o canvas não "tintar")
  const art = await loadImage(artUrl, 'anonymous');

  const W = art.naturalWidth || art.width;
  const H = art.naturalHeight || art.height;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas não suportado neste navegador');

  ctx.drawImage(art, 0, 0, W, H);

  // 2. QR em alta resolução como data URI (não tinta o canvas)
  const qrPx = Math.max(240, Math.round((W * qrSizePercent) / 100));
  const qrDataUrl = await generateQRCodeDataURL(qrValue, qrPx);
  const qrImg = await loadImage(qrDataUrl);

  // 3. QR desenhado direto no tamanho/posição escolhidos. O PNG do QR já tem fundo
  //    branco + zona de silêncio próprios — não usamos caixa branca extra (que
  //    deixava o QR pequeno na arte e podia transbordar para a parte escura).
  const qrW = (W * qrSizePercent) / 100;
  const cx = (W * qrPosition.x) / 100;
  const cy = (H * qrPosition.y) / 100;
  ctx.drawImage(qrImg, cx - qrW / 2, cy - qrW / 2, qrW, qrW);

  // 4. Download
  const pngUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = pngUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
