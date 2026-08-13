import { Users, Building2, Filter, BarChart3 } from 'lucide-react';

const PILARES = [
  { icone: Users, titulo: 'Clientes', linha: 'centralizados' },
  { icone: Building2, titulo: 'Imóveis e unidades', linha: 'organizados' },
  { icone: Filter, titulo: 'Funil de vendas', linha: 'inteligente' },
  { icone: BarChart3, titulo: 'Relatórios que', linha: 'geram resultados' },
];

/**
 * Coluna institucional do login (lado direito).
 *
 * Só aparece em telas grandes: no celular a prioridade é entrar, não ler
 * material de venda — quem está no login já decidiu usar o produto.
 *
 * Sem screenshot de dashboard com números inventados. A referência mostra
 * "35 clientes / R$ 2.480.000", e colocar isso aqui seria dado falso na porta
 * de entrada do produto — contra a regra de não inventar dado.
 */
export function PainelInstitucional() {
  return (
    <aside
      aria-label="Sobre o Lotti"
      className="hidden lg:flex flex-col items-center justify-center gap-10 px-12 py-16 bg-primary/[0.03] border-l"
    >
      <div className="text-center space-y-1 max-w-lg">
        <h2 className="text-3xl font-semibold tracking-tight text-muted-foreground">
          Mais organização. Mais controle.
        </h2>
        <p className="text-3xl font-semibold tracking-tight text-primary">Mais vendas.</p>
      </div>

      <ul className="grid grid-cols-2 xl:grid-cols-4 gap-8 max-w-2xl">
        {PILARES.map(({ icone: Icone, titulo, linha }) => (
          <li key={titulo} className="flex flex-col items-center text-center gap-2.5">
            <span className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Icone className="h-5 w-5 text-primary" />
            </span>
            <span className="text-sm">
              <span className="block font-medium text-foreground">{titulo}</span>
              <span className="block text-muted-foreground">{linha}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted-foreground text-center max-w-md">
        Do primeiro contato ao contrato assinado, num lugar só — com a IA cuidando
        do trabalho repetitivo.
      </p>
    </aside>
  );
}
