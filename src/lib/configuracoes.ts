export type DestinoConfiguracoes =
  | { tipo: 'aba'; aba: 'perfil' | 'notificacoes' | 'aparencia' | 'asaas' | 'assinatura' }
  | { tipo: 'redirecionar'; destino: '/planejamento#google-agenda' };

const ABAS = ['perfil', 'notificacoes', 'aparencia', 'asaas', 'assinatura'] as const;

export function resolverDestinoConfiguracoes(aba: string | null): DestinoConfiguracoes {
  if (aba === 'agenda') return { tipo: 'redirecionar', destino: '/planejamento#google-agenda' };
  if (ABAS.includes(aba as (typeof ABAS)[number])) {
    return { tipo: 'aba', aba: aba as (typeof ABAS)[number] };
  }
  return { tipo: 'aba', aba: 'perfil' };
}
