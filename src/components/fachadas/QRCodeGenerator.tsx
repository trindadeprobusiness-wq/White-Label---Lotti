import { useEffect, useRef, useState } from 'react';

interface QRCodeGeneratorProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * Gera QR Code usando a API pública do Google Charts.
 * Não precisa de nenhum pacote npm — funciona em qualquer ambiente.
 */
export function QRCodeGenerator({ value, size = 200, className }: QRCodeGeneratorProps) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&ecc=H&margin=8`;

  return (
    <img
      src={qrUrl}
      alt="QR Code"
      width={size}
      height={size}
      className={className}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

/**
 * Gera o QR Code como Data URL (para uso em PDFs ou downloads).
 * Usa fetch + blob + FileReader para converter a imagem da API em base64.
 */
export async function generateQRCodeDataURL(
  value: string,
  size = 400,
): Promise<string> {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&ecc=H&margin=8&format=png`;

  const response = await fetch(qrUrl);
  const blob = await response.blob();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
