import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Markdown renderizado com a tipografia do tema.
 *
 * A lista de tokens `--tw-prose-*` abaixo é o único lugar do projeto onde o
 * Markdown sabe que existe modo escuro. Ela nasceu dentro da bolha de chat da
 * IA; ao surgir o segundo lugar que renderiza Markdown (a pré-visualização do
 * prompt do agente), copiá-la garantiria que um dia as duas divergiriam.
 *
 * HTML cru não é renderizado: o `rehype-raw` não está instalado, de propósito.
 * Texto do usuário entra aqui, e aparecer como texto literal é o certo.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
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
        '[--tw-prose-td-borders:hsl(var(--border))]',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
