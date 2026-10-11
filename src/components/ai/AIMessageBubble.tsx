import { cn } from '@/lib/utils';
import { Markdown } from '@/components/ui/markdown';
import { rehypeHumanizar } from '@/lib/ia/humanizar';
import { rodapeDaResposta } from '@/lib/ia/rodape';
import type { AIMessage } from '@/types/ai';

interface AIMessageBubbleProps {
  message: AIMessage;
}

const PLUGINS_RESPOSTA = [rehypeHumanizar];

/** Hora da mensagem; de outro dia, com a data (conversa antiga reaberta). */
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hora : `${d.toLocaleDateString('pt-BR')} ${hora}`;
}

export function AIMessageBubble({ message }: AIMessageBubbleProps) {
  const isUser = message.role === 'user';
  // Resposta ainda sem texto (a IA está consultando): o indicador de digitação já mostra que há trabalho.
  if (!isUser && !message.content.trim()) return null;
  const rodape = isUser ? null : rodapeDaResposta(message.metadata);

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 max-w-[85%] rounded-2xl px-4 py-3 text-sm [overflow-wrap:anywhere]',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted rounded-bl-md'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <Markdown rehypePlugins={PLUGINS_RESPOSTA}>{message.content}</Markdown>
        )}
        <span className={cn('mt-1 block text-right text-[11px] tabular-nums', isUser ? 'opacity-80' : 'text-muted-foreground')}>
          {quando(message.created_at)}
          {rodape && <> · {rodape}</>}
        </span>
      </div>
    </div>
  );
}
