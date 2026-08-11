/**
 * Reduz a imagem antes de mandar para a IA. Foto de celular passa fácil de 4MB;
 * o modelo não precisa disso para reconhecer um cômodo, e o payload da Edge
 * Function tem teto. 1024px no maior lado resolve com folga.
 */
export function downscaleToBase64(file: File, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Erro ao carregar imagem')); };
    img.src = url;
  });
}

/**
 * Mesma redução, para foto que já está no Storage (só temos a URL).
 * `crossOrigin` é necessário senão o canvas fica "tainted" e o toDataURL lança.
 */
export function urlParaBase64(url: string, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    img.onerror = () => reject(new Error('Erro ao carregar a foto'));
    img.src = url;
  });
}
