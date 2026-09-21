import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Building2, Users, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCRMStore } from '@/stores/crmStore';

/**
 * Busca global do workspace.
 *
 * Consulta o que o DataLoader já trouxe para o store (clientes, imóveis,
 * contratos) — sem ida ao servidor a cada tecla. Como esses dados já estão em
 * memória e escopados ao corretor pela RLS, a busca é instantânea e não abre
 * superfície nova.
 */

interface Resultado {
  id: string;
  titulo: string;
  descricao: string;
  href: string;
  tipo: 'cliente' | 'imovel' | 'contrato';
}

const ICONE: Record<Resultado['tipo'], React.ReactNode> = {
  cliente: <Users className="h-4 w-4" />,
  imovel: <Building2 className="h-4 w-4" />,
  contrato: <FileText className="h-4 w-4" />,
};

const ROTULO: Record<Resultado['tipo'], string> = {
  cliente: 'Cliente',
  imovel: 'Imóvel',
  contrato: 'Contrato',
};

const MAX = 8;

export function GlobalSearch({ className }: { className?: string }) {
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { clientes, imoveis, contratos, loading } = useCRMStore();

  const resultados = useMemo<Resultado[]>(() => {
    const q = termo.trim().toLowerCase();
    if (q.length < 2) return [];

    const achados: Resultado[] = [];

    for (const c of clientes) {
      if (achados.length >= MAX) break;
      if (
        c.nome?.toLowerCase().includes(q) ||
        c.telefone?.includes(q) ||
        c.email?.toLowerCase().includes(q)
      ) {
        achados.push({
          id: `cliente-${c.id}`,
          titulo: c.nome,
          descricao: c.telefone ?? c.email ?? '',
          href: `/clientes/${c.id}`,
          tipo: 'cliente',
        });
      }
    }

    for (const i of imoveis) {
      if (achados.length >= MAX) break;
      if (
        i.titulo?.toLowerCase().includes(q) ||
        i.endereco?.toLowerCase().includes(q) ||
        i.bairro?.toLowerCase().includes(q)
      ) {
        achados.push({
          id: `imovel-${i.id}`,
          titulo: i.titulo,
          descricao: [i.bairro, i.cidade].filter(Boolean).join(', '),
          href: `/imoveis/${i.id}`,
          tipo: 'imovel',
        });
      }
    }

    for (const ct of contratos) {
      if (achados.length >= MAX) break;
      if (ct.tipo?.toLowerCase().includes(q) || ct.status?.toLowerCase().includes(q)) {
        achados.push({
          id: `contrato-${ct.id}`,
          titulo: `Contrato ${ct.tipo?.replace(/_/g, ' ').toLowerCase() ?? ''}`,
          descricao: ct.status ?? '',
          href: '/juridico',
          tipo: 'contrato',
        });
      }
    }

    return achados;
  }, [termo, clientes, imoveis, contratos]);

  useEffect(() => { setIndice(0); }, [termo]);

  // Fecha ao clicar fora — sem isto o painel fica preso aberto sobre a página.
  useEffect(() => {
    const aoClicar = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, []);

  // Ctrl/Cmd+K é o atalho que todo mundo já tenta antes de procurar o campo.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, []);

  const ir = (r: Resultado) => {
    navigate(r.href);
    setTermo('');
    setAberto(false);
    inputRef.current?.blur();
  };

  const aoTeclarNoCampo = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setAberto(false); inputRef.current?.blur(); return; }
    if (!resultados.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndice((i) => (i + 1) % resultados.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndice((i) => (i - 1 + resultados.length) % resultados.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      ir(resultados[indice]);
    }
  };

  const buscando = termo.trim().length >= 2;
  const mostrarPainel = aberto && buscando;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={mostrarPainel}
        aria-controls="resultados-busca-global"
        aria-label="Buscar clientes, imóveis ou contratos"
        value={termo}
        onChange={(e) => { setTermo(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onKeyDown={aoTeclarNoCampo}
        placeholder="Buscar clientes, imóveis ou contratos..."
        className={cn(
          'h-control w-full rounded-lg border border-border bg-card pl-11 pr-4 text-sm',
          'text-foreground placeholder:text-muted-foreground',
          'transition-colors duration-150',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />

      {mostrarPainel && (
        <div
          id="resultados-busca-global"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-overlay"
        >
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando seus dados...
            </div>
          ) : resultados.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                Nada encontrado para “{termo.trim()}”.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Busque por nome, telefone, e-mail, endereço ou bairro.
              </p>
            </div>
          ) : (
            resultados.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={i === indice}
                onMouseEnter={() => setIndice(i)}
                onClick={() => ir(r)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-100',
                  i === indice ? 'bg-accent' : 'hover:bg-muted',
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-brand text-primary">
                  {ICONE[r.tipo]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {r.titulo}
                  </span>
                  {r.descricao && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.descricao}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-strong">
                  {ROTULO[r.tipo]}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
