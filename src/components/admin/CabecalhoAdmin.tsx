import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

interface Migalha {
  label: string;
  href?: string;
}

interface CabecalhoAdminProps {
  titulo: string;
  descricao?: string;
  migalhas?: Migalha[];
  acoes?: React.ReactNode;
}

/**
 * Cabeçalho padrão das telas do back office.
 *
 * O título usa `font-serif` (Lora), que já está no tema e até agora só aparecia
 * no wordmark. É o segundo sinal — junto com o dourado da sidebar — de que esta
 * é a área da Lotti, não a do corretor, sem precisar de paleta nova.
 */
export function CabecalhoAdmin({ titulo, descricao, migalhas, acoes }: CabecalhoAdminProps) {
  return (
    <div className="mb-6 space-y-3">
      {migalhas && migalhas.length > 0 && (
        <nav aria-label="Trilha de navegação">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {migalhas.map((m, i) => (
              <li key={`${m.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />}
                {m.href ? (
                  <Link
                    to={m.href}
                    className="rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {m.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{m.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">{titulo}</h1>
          {descricao && (
            <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
          )}
        </div>
        {acoes && <div className="flex flex-shrink-0 flex-wrap gap-2">{acoes}</div>}
      </div>
    </div>
  );
}
