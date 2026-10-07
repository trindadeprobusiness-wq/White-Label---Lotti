import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, Video } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { baixarInboxApi } from '@/lib/api/arquivos';
import { cn } from '@/lib/utils';

// Ligações e áudios na conversa, no jeito do WhatsApp. O runtime grava a ligação como texto
// ("📞 Chamada de voz perdida", "📹 Chamada de vídeo · 2 min") e o áudio com media_path no
// bucket lotti-inbox-audio; aqui só se decide como desenhar.

const CHAMADA = /^(📞|📹) Chamada/u;
export const ehChamada = (texto: string) => CHAMADA.test(texto);
export const ehAudio = (texto: string) => /^(🎤 )?Áudio$/u.test(texto.trim());

export function CartaoChamada({ texto, direcao }: { texto: string; direcao: 'in' | 'out' }) {
  const video = texto.startsWith('📹');
  const perdida = /perdida$/u.test(texto);
  const recusada = /recusada$/u.test(texto);
  const falhou = perdida || recusada;
  const duracao = texto.split(' · ')[1];
  const agendada = /agendada/u.test(texto);
  const titulo = agendada ? 'Chamada agendada' : video ? 'Chamada de vídeo' : 'Chamada de voz';
  const detalhe = perdida ? 'Perdida' : recusada ? 'Recusada' : duracao ? duracao
    : agendada ? texto.split('\n')[1] ?? '' : direcao === 'out' ? 'Realizada' : 'Atendida';
  const Icone = falhou ? PhoneMissed : video ? Video : direcao === 'out' ? PhoneOutgoing : PhoneIncoming;
  return (
    <div className="flex min-w-[200px] items-center gap-3 py-0.5" data-testid="cartao-chamada">
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
        falhou ? 'bg-red-500/15 text-red-500' : 'bg-emerald-500/15 text-emerald-500')}>
        <Icone className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium leading-tight">{titulo}</span>
        {detalhe && <span className={cn('block text-xs', falhou ? 'text-red-500' : 'opacity-75')}>{detalhe}</span>}
      </span>
    </div>
  );
}

const relogio = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const t = Math.floor(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function PlayerAudio({ caminho }: { caminho: string | null }) {
  const [url, setUrl] = useState('');
  const [falhou, setFalhou] = useState(false);
  const [tocando, setTocando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    let objeto = '';
    const pronto = (u: string) => { if (vivo) { setUrl(u); setFalhou(false); } };
    const erro = () => { if (vivo) { setUrl(''); setFalhou(true); } };
    if (apiDisponivel()) {
      baixarInboxApi('lotti-inbox-audio', caminho)
        .then((u) => { if (vivo) { objeto = u; pronto(u); } else URL.revokeObjectURL(u); })
        .catch(erro);
    } else {
      void supabase.storage.from('lotti-inbox-audio').createSignedUrl(caminho, 3600)
        .then(({ data, error }) => (error || !data?.signedUrl ? erro() : pronto(data.signedUrl)));
    }
    return () => { vivo = false; if (objeto) URL.revokeObjectURL(objeto); };
  }, [caminho]);

  if (!caminho || falhou) {
    return (
      <div className="flex min-w-[180px] items-center gap-2.5 py-0.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-current/10"><Mic className="h-4 w-4" /></span>
        <span className="min-w-0">
          <span className="block text-[14px] font-medium leading-tight">Áudio</span>
          <span className="block text-[11px] opacity-75">{falhou ? 'Indisponível no momento' : 'Ouça no WhatsApp do celular'}</span>
        </span>
      </div>
    );
  }

  const alternar = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFalhou(true)); else el.pause();
  };
  const total = duracao || 0;
  return (
    <div className="flex min-w-[220px] max-w-[300px] items-center gap-2.5 py-0.5" data-testid="player-audio">
      <button type="button" onClick={alternar} disabled={!url} aria-label={tocando ? 'Pausar áudio' : 'Tocar áudio'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-current/15 hover:bg-current/25 disabled:opacity-50">
        {tocando ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <span className="min-w-0 flex-1">
        <input type="range" min={0} max={total || 1} step={0.1} value={Math.min(tempo, total || 1)} aria-label="Posição do áudio"
          onChange={(e) => { const el = audio.current; if (el) { el.currentTime = Number(e.target.value); setTempo(el.currentTime); } }}
          className="h-1 w-full cursor-pointer accent-current" />
        <span className="mt-0.5 flex justify-between text-[11px] opacity-75">
          <span>{relogio(tocando || tempo ? tempo : total)}</span>
          <Mic className="h-3 w-3" />
        </span>
      </span>
      <audio ref={audio} src={url || undefined} preload="metadata" className="hidden"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          // ogg/webm do WhatsApp às vezes chegam sem duração (Infinity): força o cálculo.
          if (Number.isFinite(el.duration)) setDuracao(el.duration);
          else { el.currentTime = 1e7; el.ontimeupdate = () => { el.ontimeupdate = null; setDuracao(el.duration); el.currentTime = 0; }; }
        }}
        onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
        onPlay={() => setTocando(true)} onPause={() => setTocando(false)}
        onEnded={() => { setTocando(false); setTempo(0); }} />
    </div>
  );
}
