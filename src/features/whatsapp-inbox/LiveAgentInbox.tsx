import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import ConnectedInbox from './ConnectedInbox';
import { useWhatsAppConnectionQuery } from './useWhatsAppConnection';
import { WhatsAppConnection } from './WhatsAppConnection';

export default function LiveAgentInbox() {
  const { user } = useAuth();
  const { search } = useLocation();
  const previewMode = new URLSearchParams(search).get('preview');
  const preview = import.meta.env.DEV && previewMode === 'connected';
  const pairingPreview = import.meta.env.DEV && previewMode === 'pairing';
  const connection = useWhatsAppConnectionQuery(user?.id);
  // A última leitura vale até chegar outra. Antes, exigir `!isPending` e
  // `!isError` fazia qualquer consulta de status em voo — ou uma única falha,
  // numa consulta que roda a cada 8 segundos — derrubar o Inbox inteiro para a
  // tela de "conectar o número". Era isso que aparecia ao sair da aba e voltar.
  // O React Query mantém `data` da última resposta boa mesmo quando a seguinte
  // falha; é nela que se confia.
  const estado = connection.data?.state;

  if (preview) return <div className="-mx-5 -mb-16 -mt-20 animate-fade-in md:-mx-8 md:-mt-8"><ConnectedInbox connected={false} preview /></div>;

  if (pairingPreview) return <div className="mx-auto max-w-3xl animate-fade-in"><WhatsAppConnection previewPairing /></div>;

  // Primeira consulta ainda em voo: não dá para afirmar que está desconectado.
  // `failureCount` e não `isError`: com a nova tentativa automática, `isError`
  // só vira verdadeiro depois do segundo erro, e a tela ficaria presa aqui.
  // Na primeira falha já mostra a conexão, que sabe explicar o problema.
  if (estado === undefined && connection.failureCount === 0) {
    return <div role="status" className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">Abrindo o Inbox…</div>;
  }

  if (estado !== 'connected') return <div className="mx-auto max-w-3xl animate-fade-in"><WhatsAppConnection autoStart /></div>;

  return <div className="-mx-5 -mb-16 -mt-20 animate-fade-in md:-mx-8 md:-mt-8"><ConnectedInbox connected /></div>;
}
