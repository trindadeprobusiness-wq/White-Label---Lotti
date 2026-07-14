import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { AIMessage } from '@/types/ai';

interface AIMessageBubbleProps {
  message: AIMessage;
}

export function AIMessageBubble({ message }: AIMessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted rounded-bl-md'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div
            className={cn(
              'prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
              // Força a tipografia a usar os tokens do tema em vez da paleta cinza
              // padrão do @tailwindcss/typography. Os tokens já invertem entre claro/escuro.
              '[--tw-prose-body:hsl(var(--foreground))]',
              '[--tw-prose-headings:hsl(var(--foreground))]',
              '[--tw-prose-bold:hsl(var(--foreground))]',
              '[--tw-prose-links:hsl(var(--primary))]',
              '[--tw-prose-code:hsl(var(--foreground))]',
              '[--tw-prose-quotes:hsl(var(--foreground))]',
              '[--tw-prose-bullets:hsl(var(--muted-foreground))]',
              '[--tw-prose-counters:hsl(var(--muted-foreground))]',
              '[--tw-prose-hr:hsl(var(--border))]',
              '[--tw-prose-quote-borders:hsl(var(--border))]',
              '[--tw-prose-pre-bg:hsl(var(--background))]',
              '[--tw-prose-pre-code:hsl(var(--foreground))]',
              '[--tw-prose-th-borders:hsl(var(--border))]',
              '[--tw-prose-td-borders:hsl(var(--border))]'
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        <span className="block text-[10px] opacity-60 mt-1 text-right">
          {new Date(message.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}
