import { useEffect, useRef, useState } from 'react';

const BARRAS = 40;
// Uma barra nova a cada 140 ms (~7 por segundo): mais rápido parecia tremer em vez de acompanhar a fala.
const INTERVALO_MS = 140;

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
    // Criado depois do pedido de microfone (fora do clique), o Chrome pode deixar o áudio suspenso, e o
    // analisador lê só silêncio: as barras não acompanhavam a voz.
    void contexto.resume().catch(() => undefined);
    const analisador = contexto.createAnalyser();
    analisador.fftSize = 512;
    contexto.createMediaStreamSource(stream).connect(analisador);
    const amostras = new Uint8Array(analisador.fftSize);
    let ultimo = 0;
    let pico = 0;
    const passo = (agora: number) => {
      quadro.current = requestAnimationFrame(passo);
      // Lê o volume a cada quadro e guarda o PICO do intervalo: uma leitura solta pegava silêncio ou
      // estalo por acaso, e a barra não batia com a sílaba falada.
      analisador.getByteTimeDomainData(amostras);
      let soma = 0;
      for (const v of amostras) { const x = (v - 128) / 128; soma += x * x; }
      pico = Math.max(pico, Math.sqrt(soma / amostras.length));
      if (agora - ultimo < INTERVALO_MS) return;
      ultimo = agora;
      // Voz falada fica perto de 0,02–0,25 de RMS: a curva abre o meio da escala, onde a fala está.
      const nivel = Math.min(1, Math.pow(pico * 5, 0.75));
      pico = 0;
      setNiveis(atual => [...atual.slice(1), Math.max(0.08, nivel)]);
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
