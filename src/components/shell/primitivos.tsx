import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Primitivos visuais compartilhados pelas telas do produto.
 *
 * Ficam juntos num arquivo porque são pequenos e sempre usados em conjunto —
 * espalhá-los em nove arquivos de vinte linhas só aumentaria o custo de achar
 * o que existe e faria alguém reimplementar o que já está pronto.
 */

/* ── Cartão de seção ────────────────────────────────────────────────────── */

export function SectionCard({
  titulo, acao, children, className, semPadding = false,
}: {
  titulo?: React.ReactNode;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  semPadding?: boolean;
}) {
  return (
    <section
      className={cn(
        // `min-w-0` é obrigatório aqui: item de grid/flex nasce com
        // `min-width: auto`, que é o tamanho do conteúdo. Sem isto, um nome
        // longo dentro da lista estica o cartão inteiro para além da viewport
        // e o `truncate` dos filhos nunca chega a agir.
        'min-w-0 rounded-card border border-border bg-card shadow-card',
        className,
      )}
    >
      {(titulo || acao) && (
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
          {typeof titulo === 'string' ? (
            <h2 className="text-section text-foreground">{titulo}</h2>
          ) : (
            titulo
          )}
          {acao}
        </div>
      )}
      <div className={cn(!semPadding && 'px-5 pb-5', !titulo && !semPadding && 'pt-5')}>
        {children}
      </div>
    </section>
  );
}

/* ── Métricas ───────────────────────────────────────────────────────────── */

export type TomMetrica = 'brand' | 'success' | 'warning' | 'info' | 'doc' | 'destructive';

const TOM_FUNDO: Record<TomMetrica, string> = {
  brand: 'bg-surface-brand text-primary',
  success: 'bg-success-surface text-success',
  warning: 'bg-warning-surface text-warning',
  info: 'bg-info-surface text-info',
  doc: 'bg-doc-surface text-doc',
  destructive: 'bg-destructive-surface text-destructive',
};

export interface ItemMetrica {
  id: string;
  valor: React.ReactNode;
  label: string;
  icone?: React.ReactNode;
  tom?: TomMetrica;
}

/**
 * Faixa horizontal de indicadores, dividida por separadores verticais.
 *
 * É um cartão só, não N cartões lado a lado: os números são lidos em conjunto
 * ("26 clientes para 27 imóveis"), e separá-los em caixas independentes quebra
 * essa leitura.
 */
export function MetricStrip({
  itens, carregando = false, className,
}: {
  itens: ItemMetrica[];
  carregando?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 rounded-card border border-border bg-card shadow-card',
        'lg:grid-cols-4',
        className,
      )}
    >
      {itens.map((item, i) => (
        <div
          key={item.id}
          className={cn(
            'flex items-center gap-3.5 p-5',
            // Divisor só entre colunas da mesma linha; no grid de 2 colunas do
            // mobile, o da esquerda não pode ganhar borda à direita na 2ª coluna.
            i % 2 === 1 && 'border-l border-border',
            'lg:border-l lg:first:border-l-0',
            i < 2 && 'border-b border-border lg:border-b-0',
          )}
        >
          {item.icone && (
            <span
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                TOM_FUNDO[item.tom ?? 'brand'],
              )}
            >
              {item.icone}
            </span>
          )}
          <div className="min-w-0">
            {carregando ? (
              <Skeleton className="h-7 w-14" />
            ) : (
              <p className="text-kpi tabular text-foreground">{item.valor}</p>
            )}
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Cartão de KPI isolado — usado onde a referência mostra caixas separadas. */
export function MetricCard({
  valor, label, icone, tom = 'brand', detalhe, carregando = false,
}: {
  valor: React.ReactNode;
  label: string;
  icone?: React.ReactNode;
  tom?: TomMetrica;
  detalhe?: React.ReactNode;
  carregando?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-3.5">
        {icone && (
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
              TOM_FUNDO[tom],
            )}
          >
            {icone}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          {carregando ? (
            <Skeleton className="mt-1.5 h-7 w-24" />
          ) : (
            <p className="mt-0.5 text-kpi tabular text-foreground">{valor}</p>
          )}
        </div>
      </div>
      {detalhe && <div className="mt-3 text-xs text-muted-foreground">{detalhe}</div>}
    </div>
  );
}

/* ── Linha de ação ──────────────────────────────────────────────────────── */

/** Linha clicável com ícone, texto e chevron — atalhos e prioridades. */
export function QuickActionRow({
  icone, titulo, descricao, href, onClick, acao, tom = 'brand',
}: {
  icone: React.ReactNode;
  titulo: string;
  descricao?: string;
  href?: string;
  onClick?: () => void;
  /** Substitui o chevron por um controle próprio (ex.: botão "Ver leads"). */
  acao?: React.ReactNode;
  tom?: TomMetrica;
}) {
  const bloco = (
    <>
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          TOM_FUNDO[tom],
        )}
      >
        {icone}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{titulo}</span>
        {descricao && (
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {descricao}
          </span>
        )}
      </span>
    </>
  );

  const classe = cn(
    'flex w-full items-center gap-3.5 rounded-lg px-3 py-3 text-left',
    'transition-colors duration-150 hover:bg-muted focus-ring',
  );

  // Com ação própria não vira link: aninhar botão dentro de link é HTML
  // inválido e captura o clique errado.
  if (acao) {
    return (
      // Empilha no mobile. O Button do shadcn é `whitespace-nowrap`, então um
      // rótulo como "Completar cadastros" não encolhe — lado a lado com o
      // texto, ele empurrava a linha para fora da viewport de 390px.
      <div className="flex w-full flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">{bloco}</div>
        <div className="shrink-0 pl-[3.375rem] sm:pl-0">{acao}</div>
      </div>
    );
  }

  const comChevron = (
    <>
      {bloco}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </>
  );

  if (href) return <Link to={href} className={classe}>{comChevron}</Link>;
  return <button type="button" onClick={onClick} className={classe}>{comChevron}</button>;
}

/* ── Estados ────────────────────────────────────────────────────────────── */

export function EmptyState({
  icone, titulo, descricao, acao, secundaria, className,
}: {
  icone?: React.ReactNode;
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
  secundaria?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {icone && (
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icone}
        </span>
      )}
      <p className="text-card-title text-foreground">{titulo}</p>
      {descricao && (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{descricao}</p>
      )}
      {(acao || secundaria) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
          {acao}
          {secundaria}
        </div>
      )}
    </div>
  );
}

/* ── Badge de status ────────────────────────────────────────────────────── */

export type TomBadge = 'neutro' | 'brand' | 'success' | 'warning' | 'info' | 'doc' | 'destructive';

const TOM_BADGE: Record<TomBadge, string> = {
  neutro: 'bg-muted text-muted-foreground border-border',
  brand: 'bg-surface-brand text-primary border-brand-100',
  success: 'bg-success-surface text-success border-success/20',
  warning: 'bg-warning-surface text-warning border-warning/25',
  info: 'bg-info-surface text-info border-info/20',
  doc: 'bg-doc-surface text-doc border-doc/20',
  destructive: 'bg-destructive-surface text-destructive border-destructive/20',
};

export function StatusBadge({
  children, tom = 'neutro', comPonto = false, className,
}: {
  children: React.ReactNode;
  tom?: TomBadge;
  /** Ponto colorido antes do texto — não depender só de cor para o status. */
  comPonto?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1',
        // `whitespace-nowrap` mantém "Dados incompletos" numa linha; `shrink-0`
        // impede que ele seja espremido. Quem cede espaço é o texto ao lado,
        // que trunca — o status é curto e precisa continuar legível.
        'whitespace-nowrap text-xs font-medium leading-none',
        TOM_BADGE[tom],
        className,
      )}
    >
      {comPonto && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ── Abas sublinhadas ───────────────────────────────────────────────────── */

/**
 * Estilo de abas das referências: sublinhado verde, sem a "pílula" cinza que
 * é o padrão do shadcn. Exportado como classe em vez de componente novo para
 * continuar usando `Tabs` do Radix — só a aparência muda, o comportamento e a
 * acessibilidade seguem os mesmos.
 *
 * Uso:
 *   <TabsList className={abasSublinhadas.lista}>
 *     <TabsTrigger className={abasSublinhadas.gatilho} value="x">…</TabsTrigger>
 */
export const abasSublinhadas = {
  lista: cn(
    'h-auto w-full justify-start gap-1 rounded-none border-b border-border',
    'bg-transparent p-0 text-muted-foreground',
  ),
  gatilho: cn(
    'relative rounded-none border-b-2 border-transparent bg-transparent',
    'px-3.5 pb-3 pt-2 text-sm font-medium shadow-none',
    'transition-colors duration-150',
    'hover:text-foreground',
    'data-[state=active]:border-primary data-[state=active]:bg-transparent',
    'data-[state=active]:text-primary data-[state=active]:shadow-none',
  ),
};

/* ── Avatar ─────────────────────────────────────────────────────────────── */

export function Avatar({
  nome, className,
}: {
  nome?: string | null;
  className?: string;
}) {
  const letras = (() => {
    if (!nome?.trim()) return '?';
    const p = nome.trim().split(/\s+/);
    return p.length === 1
      ? p[0].slice(0, 2).toUpperCase()
      : (p[0][0] + p[p.length - 1][0]).toUpperCase();
  })();

  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
        'bg-surface-brand text-xs font-semibold text-primary',
        className,
      )}
      aria-hidden="true"
    >
      {letras}
    </span>
  );
}
