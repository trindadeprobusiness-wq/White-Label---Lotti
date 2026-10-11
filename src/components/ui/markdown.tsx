import ReactMarkdown, { type Components, type Options } from 'react-markdown';
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

/**
 * Fora do componente: um objeto novo a cada render trocaria o tipo do elemento e a tabela remontaria a cada
 * pedaço do stream, voltando a rolagem lateral para o começo. `node` não vai para o DOM.
 */
const COMPONENTES: Components = {
  // Tabela larga rola de lado dentro da bolha, em vez de alargar a coluna ou ser cortada.
  table: ({ node: _node, className, ...props }) => (
    <div role="region" aria-label="Tabela" tabIndex={0} className="my-4 max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
      <table className={cn('my-0', className)} {...props} />
    </div>
  ),
  // Imagem externa não carrega (evita pixel de rastreio e link montado com dado da conta): fica o texto alternativo.
  img: ({ alt }) => (alt ? <span className="text-muted-foreground">[{alt}]</span> : null),
  // Link abre em outra aba: a conversa e o stream em andamento continuam onde estavam.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" />,
};

export function Markdown({ children, className, rehypePlugins }: { children: string; className?: string; rehypePlugins?: Options['rehypePlugins'] }) {
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={COMPONENTES}>{children}</ReactMarkdown>
    </div>
  );
}
