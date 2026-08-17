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
    <div className={cn('flex flex-col items-center py-10 text-center', className)}>
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-brand text-primary">
        <Sparkles className="h-6 w-6" />
      </span>

      <h2 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
        Olá, {primeiroNome(nome)}.
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Posso ajudar você a consultar informações, organizar tarefas e executar ações
        na Lotti.
      </p>

      <div className="mt-7 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        {SUGESTOES.map((s) => (
          <button
            key={s.titulo}
            type="button"
            onClick={() => onSugestao(s.prompt)}
            className={cn(
              'flex items-center gap-3 rounded-card border border-border bg-card p-3.5 text-left',
              'transition-colors duration-150 hover:border-border-strong hover:bg-muted focus-ring',
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-primary">
              <s.Icone className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1 text-sm leading-snug">
              <span className="block font-medium text-foreground">{s.titulo}</span>
              <span className="block text-muted-foreground">{s.complemento}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>

      {/* O que a IA alcança. Sem isso, a primeira pergunta costuma ser sobre
          algo que ela não vê, e a resposta frustra. */}
      <p className="mt-7 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {ESCOPOS.map((escopo, i) => (
          <span key={escopo} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true">•</span>}
            {escopo}
          </span>
        ))}
      </p>
    </div>
  );
}
