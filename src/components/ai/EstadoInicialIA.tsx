import { Sparkles, Users, Building2, TrendingUp, FileText, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tela de partida do assistente.
 *
 * Substituiu um balão de mensagem que listava as capacidades em markdown. A
 * diferença não é estética: aquele texto parecia uma resposta já dada, e o
 * corretor precisava ler tudo e formular a pergunta do zero. Aqui cada
 * sugestão é clicável e preenche o campo — o primeiro uso deixa de exigir que
 * a pessoa adivinhe o que perguntar.
 */

const SUGESTOES = [
  {
    Icone: Users,
    titulo: 'Quais clientes',
    complemento: 'precisam de retorno?',
    prompt: 'Quais clientes estão há mais tempo sem contato e precisam de retorno?',
  },
  {
    Icone: Building2,
    titulo: 'Buscar imóveis',
    complemento: 'por faixa de preço',
    prompt: 'Liste os imóveis disponíveis agrupados por faixa de preço.',
  },
  {
    Icone: TrendingUp,
    titulo: 'Resumir o financeiro',
    complemento: 'do mês',
    prompt: 'Faça um resumo do meu financeiro deste mês: receitas, despesas e resultado.',
  },
  {
    Icone: FileText,
    titulo: 'Gerar um contrato',
    complemento: 'com IA',
    prompt: 'Quero gerar um contrato. Quais informações você precisa de mim?',
  },
] as const;

const ESCOPOS = ['Clientes', 'Imóveis', 'Financeiro', 'Contratos', 'Documentos'];

function primeiroNome(nome?: string | null): string {
  if (!nome?.trim()) return 'tudo bem';
  return nome.trim().split(/\s+/)[0];
}

export function EstadoInicialIA({
  nome,
  onSugestao,
  className,
}: {
  nome?: string | null;
  onSugestao: (prompt: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center py-2 text-center', className)}>
      <span className="relative isolate my-2 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/5 text-primary before:absolute before:-inset-1.5 before:-z-10 before:rotate-12 before:rounded-[20px] before:border before:border-primary/15 after:absolute after:-inset-1 after:-z-10 after:-rotate-6 after:rounded-2xl after:border after:border-primary/10">
        <Sparkles className="h-5 w-5" />
      </span>

      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Inteligência para sua operação imobiliária</p>
      <h2 className="mt-2 text-xl lg:text-2xl font-semibold tracking-tight text-foreground">
        O que você quer entender hoje?
      </h2>
      <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
        Consulte seus dados e encontre os próximos passos para sua operação.
      </p>

      <div className="mt-3 flex flex-wrap justify-center gap-1.5">{ESCOPOS.map(escopo => <span key={escopo} className="rounded-full border border-border/70 px-2.5 py-1 text-[10px] text-muted-foreground">{escopo}</span>)}</div>
      <div className="mt-5 grid w-full max-w-2xl gap-2.5 sm:grid-cols-2">
        {SUGESTOES.map((s) => (
          <button
            key={s.titulo}
            type="button"
            onClick={() => onSugestao(s.prompt)}
            className={cn(
              'flex min-h-[54px] items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left',
              'transition-colors duration-150 hover:border-border-strong hover:bg-muted focus-ring',
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary">
              <s.Icone className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 text-xs leading-snug">
              <span className="font-medium text-foreground">{s.titulo} {s.complemento}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>

    </div>
  );
}
