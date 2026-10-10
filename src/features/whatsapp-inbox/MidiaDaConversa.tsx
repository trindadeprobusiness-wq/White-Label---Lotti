import { useEffect, useState } from 'react';
import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
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

export function PlayerAudio({ caminho }: { caminho: string | null }) {
  const [url, setUrl] = useState('');
  const [falhou, setFalhou] = useState(false);

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

  // Como no Clix: o ícone de voz e o player do próprio navegador (play, posição, tempo, velocidade).
  return (
    <div className="flex min-w-[240px] max-w-[320px] items-center gap-2 py-0.5" data-testid="player-audio">
      <span aria-hidden className="text-[20px] leading-none">🎙️</span>
      {caminho && url && !falhou
        ? <audio src={url} controls preload="metadata" className="h-10 min-w-0 flex-1" />
        : <span className="text-[13px] opacity-75">{falhou || !caminho ? 'Áudio indisponível no momento' : 'Carregando áudio…'}</span>}
    </div>
  );
}
