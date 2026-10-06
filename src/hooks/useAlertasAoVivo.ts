import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useCRMStore } from '@/stores/crmStore';
import { apiDisponivel, escutarSino } from '@/lib/api';
import { obterSuporte } from '@/lib/admin/suporte';

/**
 * Mantém o sino vivo.
 *
 * O problema que isto resolve: `fetchAlertas()` só rodava uma vez, no
 * DataLoader, durante o bootstrap. O webhook do Asaas gravava o recebimento em
 * `alertas`, o corretor ficava com a tela aberta a tarde inteira, e o sino
 * continuava zerado até alguém apertar F5. Um sino que só atualiza no reload
 * não é notificação — é histórico.
 *
 * Estratégia em duas camadas, de propósito:
 *
 *  1. Realtime (`postgres_changes`) — chega em ~1 s, é o comportamento que o
 *     corretor espera do painel do Asaas.
 *  2. Sondagem — a rede de segurança. O Realtime exige que `alertas` esteja na
 *     publication `supabase_realtime`, e isso é configuração de banco que pode
 *     não estar aplicada. Sem a camada 2, o sino ficaria silenciosamente morto
 *     nesse cenário, que é exatamente o estado do projeto hoje.
 *
 * A sondagem no foco da janela é a que mais rende na prática: o corretor sai
 * para o app do banco, confirma o PIX, e volta — e é ao voltar que ele quer
 * ver o alerta.
 */

/** Sondagem de fundo. 90 s é barato (uma linha por corretor) e não parece parado. */
const INTERVALO_MS = 90_000;
/** Agrupa rajadas: o webhook pode gravar recebimento e repasse quase juntos. */
const DEBOUNCE_MS = 400;

export function useAlertasAoVivo() {
  const fetchAlertas = useCRMStore((s) => s.fetchAlertas);
  const corretorId = useCRMStore((s) => s.corretor?.id ?? null);

  // Guarda a função num ref para o efeito não reassinar o canal a cada render
  // do store — reassinar derruba a conexão e perde eventos na janela entre uma
  // e outra.
  const fetchRef = useRef(fetchAlertas);
  fetchRef.current = fetchAlertas;

  useEffect(() => {
    let vivo = true;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let canal: RealtimeChannel | undefined;
    let controle: AbortController | undefined;
    let reconexao: ReturnType<typeof setTimeout> | undefined;

    const atualizar = () => {
      if (!vivo) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!vivo) return;
        void fetchRef.current().catch(() => {
          // Silêncio proposital: falha de rede aqui não merece toast. A próxima
          // sondagem resolve, e um erro por sondagem viraria ruído constante.
        });
      }, DEBOUNCE_MS);
    };

    const aoVoltar = () => {
      if (document.visibilityState === 'visible') atualizar();
    };

    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', atualizar);
    const intervalo = setInterval(atualizar, INTERVALO_MS);

    // Fase 4: com a API Lotti ligada, o aviso ao vivo vem do SSE dela (gatilho
    // lotti_alertas no banco). Se a conexão cai, tenta de novo em 5 s; a
    // sondagem continua valendo no meio-tempo.
    const escutarApi = async () => {
      while (vivo) {
        controle = new AbortController();
        try {
          await escutarSino(atualizar, controle.signal);
        } catch {
          // queda ou API fora do ar: a sondagem cobre
        }
        if (!vivo) return;
        await new Promise((r) => { reconexao = setTimeout(r, 5000); });
      }
    };

    // Sem corretor carregado ainda, o filtro do canal seria inválido. A
    // sondagem já cobre o intervalo até o DataLoader terminar.
    // No atendimento do backoffice o aviso ao vivo fica desligado (como o Realtime
    // no modo Supabase): a API recusa o SSE com o token de atendimento. A sondagem
    // segue valendo.
    if (corretorId && apiDisponivel()) {
      if (!obterSuporte()) void escutarApi();
    } else if (corretorId) {
      canal = supabase
        .channel(`alertas:${corretorId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'alertas',
            // Redundante com a RLS de propósito: reduz o tráfego a este
            // corretor em vez de receber tudo e descartar no cliente. A RLS
            // continua sendo a garantia — este filtro é economia, não defesa.
            filter: `corretor_id=eq.${corretorId}`,
          },
          atualizar,
        )
        .subscribe();
    }

    return () => {
      vivo = false;
      clearTimeout(debounce);
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', atualizar);
      if (canal) void supabase.removeChannel(canal);
      controle?.abort();
      clearTimeout(reconexao);
    };
  }, [corretorId]);
}
