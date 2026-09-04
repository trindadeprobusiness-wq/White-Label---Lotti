import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { numero } from '@/lib/formato';

interface PaginacaoAdminProps {
  pagina: number;
  porPagina: number;
  total: number;
  aoMudarPagina: (pagina: number) => void;
}

/**
 * Paginação server-side.
 *
 * O `ui/pagination` do shadcn estava no repositório desde sempre e nunca havia
 * sido importado por ninguém — nenhuma tela da Lotti pagina, todas renderizam a
 * lista inteira. Com milhares de corretores isso deixaria de funcionar, então
 * o back office pagina no Postgres (LIMIT/OFFSET + count) desde o primeiro dia.
 *
 * Janela deslizante de até 5 números: com 400 páginas, listar todas seria pior
 * que não ter paginação.
 */
export function PaginacaoAdmin({
  pagina,
  porPagina,
  total,
  aoMudarPagina,
}: PaginacaoAdminProps) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  if (total === 0) return null;

  const primeiro = (pagina - 1) * porPagina + 1;
  const ultimo = Math.min(pagina * porPagina, total);

  const inicioJanela = Math.max(1, Math.min(pagina - 2, totalPaginas - 4));
  const paginas = Array.from(
    { length: Math.min(5, totalPaginas) },
    (_, i) => inicioJanela + i,
  ).filter((p) => p <= totalPaginas);

  const ir = (destino: number) => {
    const alvo = Math.min(Math.max(1, destino), totalPaginas);
    if (alvo !== pagina) aoMudarPagina(alvo);
  };

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {numero(primeiro)}–{numero(ultimo)} de {numero(total)}
      </p>

      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-label="Página anterior"
              aria-disabled={pagina <= 1}
              className={pagina <= 1 ? 'pointer-events-none opacity-50' : undefined}
              onClick={(e) => {
                e.preventDefault();
                ir(pagina - 1);
              }}
            />
          </PaginationItem>

          {paginas.map((p) => (
            <PaginationItem key={p} className="hidden sm:block">
              <PaginationLink
                href="#"
                isActive={p === pagina}
                aria-label={`Página ${p}`}
                onClick={(e) => {
                  e.preventDefault();
                  ir(p);
                }}
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ))}

          <PaginationItem>
            <PaginationNext
              href="#"
              aria-label="Próxima página"
              aria-disabled={pagina >= totalPaginas}
              className={
                pagina >= totalPaginas ? 'pointer-events-none opacity-50' : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                ir(pagina + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
