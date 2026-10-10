import { useEffect, useRef, useState } from 'react';

const BARRAS = 48;

/**
 * Onda do som ao vivo enquanto grava (como no ChatGPT/WhatsApp): barras que sobem com a voz e um
 * cronômetro. Lê o volume do próprio microfone (AnalyserNode); sem Web Audio, só o cronômetro aparece.
 */
export function OndaDaVoz({ stream }: { stream: MediaStream | undefined }) {
  const [niveis, setNiveis] = useState<number[]>(() => Array(BARRAS).fill(0.08));
  const [segundos, setSegundos] = useState(0);
  const quadro = useRef<number>();

  useEffect(() => {
    const inicio = Date.now();
    const relogio = setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 250);
    const Contexto = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!stream || !Contexto) return () => clearInterval(relogio);
    const contexto = new Contexto();
    const analisador = contexto.createAnalyser();
    analisador.fftSize = 512;
    contexto.createMediaStreamSource(stream).connect(analisador);
    const amostras = new Uint8Array(analisador.fftSize);
    let ultimo = 0;
    const passo = (agora: number) => {
      quadro.current = requestAnimationFrame(passo);
      if (agora - ultimo < 70) return; // ~14 barras novas por segundo, como uma onda andando
      ultimo = agora;
      analisador.getByteTimeDomainData(amostras);
      let soma = 0;
      for (const v of amostras) { const x = (v - 128) / 128; soma += x * x; }
      const volume = Math.min(1, Math.sqrt(soma / amostras.length) * 4);
      setNiveis(atual => [...atual.slice(1), Math.max(0.08, volume)]);
    };
    quadro.current = requestAnimationFrame(passo);
    return () => { clearInterval(relogio); if (quadro.current) cancelAnimationFrame(quadro.current); void contexto.close(); };
  }, [stream]);

  const tempo = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
  return <div role="status" aria-label="Gravando áudio" className="flex min-h-9 flex-1 items-center gap-2 px-2">
    <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
    <div aria-hidden className="flex h-8 flex-1 items-center justify-between gap-[2px] overflow-hidden">
      {niveis.map((n, i) => <span key={i} className="w-[3px] shrink-0 rounded-full bg-primary/70" style={{ height: `${Math.round(n * 100)}%` }} />)}
    </div>
    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{tempo}</span>
  </div>;
}
