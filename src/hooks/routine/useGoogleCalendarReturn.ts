import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { sincronizarGoogleApi } from '@/lib/api/rotina';

/**
 * Trata a volta do consentimento do Google Agenda, em qualquer página.
 *
 * A Edge Function `google-calendar-auth` encerra o fluxo redirecionando para
 * GOOGLE_CALENDAR_APP_REDIRECT_URL com `?google_calendar=connected|error`.
 *
 * DOIS DEFEITOS QUE ISTO CORRIGE:
 *
 * 1. O parâmetro só era lido dentro de `GoogleCalendarPanel`, componente que
 *    não é renderizado em lugar nenhum. Quem autorizava a conta voltava em
 *    silêncio — sem aviso de sucesso, sem aviso de falha, e com o parâmetro
 *    pendurado na URL, reaparecendo a cada recarga.
 *
 * 2. O destino da volta é um secret do servidor, e o valor publicado aponta
 *    para `/configuracoes?tab=agenda` — página que não hospeda mais a agenda.
 *    Por isso o tratamento mora no layout, e não na Rotina: a volta pode cair
 *    em qualquer rota, e corrigir o secret não pode ser pré-requisito para a
 *    pessoa saber que a conexão deu certo.
 */
export function useGoogleCalendarReturn() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const handled = useRef(false);

  useEffect(() => {
    const result = params.get('google_calendar');
    if (!result || handled.current) return;

    // Uma volta do OAuth é evento único: sem esta trava o efeito reagiria à
    // própria limpeza do parâmetro e dispararia a sincronização duas vezes.
    handled.current = true;

    if (result === 'connected') {
      toast.success('Google Agenda conectado. A primeira sincronização começou.');
      const primeiraSync: Promise<unknown> = apiDisponivel()
        ? sincronizarGoogleApi('sync')
        : supabase.functions.invoke('google-calendar-sync', { body: { action: 'sync' } });
      void primeiraSync
        .catch(() => undefined)
        .finally(() => {
          void qc.invalidateQueries({ queryKey: ['routine'] });
        });
    } else {
      toast.error('A conexão com o Google não foi concluída. Tente novamente.');
    }

    const next = new URLSearchParams(params);
    next.delete('google_calendar');
    setParams(next, { replace: true });
  }, [params, setParams, qc]);
}
