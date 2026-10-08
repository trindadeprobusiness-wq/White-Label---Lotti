import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Handshake,
  Receipt,
  Wallet,
  ScrollText,
  Settings,
  ArrowLeft,
  Menu,
  X,
  ListChecks,
  CreditCard,
  Banknote,
  MessageSquareX,
  Send,
  Megaphone,
  PlugZap,
  ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { usePapeis } from '@/hooks/admin/usePapeis';
import type { Recurso } from '@/lib/admin/permissoes';
import { Button } from '@/components/ui/button';

interface ItemMenu {
  recurso: Recurso;
  label: string;
  href: string;
  icone: React.ReactNode;
}

interface GrupoMenu {
  /** Sem titulo = grupo de topo, sem cabecalho. */
  titulo?: string;
  itens: ItemMenu[];
}

/**
 * Sidebar fixa, diferente da AppSidebar (que abre no hover).
 *
 * A animação faz sentido no app do corretor, onde a área útil é o que importa.
 * Num painel administrativo o operador navega entre módulos o tempo todo e
 * precisa da hierarquia sempre visível — um menu que encolhe atrapalha.
 * As cores continuam sendo os tokens --sidebar-*, então o painel não vira
 * uma ilha visual.
 */
const GRUPOS: GrupoMenu[] = [
  {
    itens: [
      { recurso: 'visao_geral', label: 'Visão geral', href: '/admin', icone: <LayoutDashboard className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'diagnosticos', label: 'Diagnósticos comerciais', href: '/admin/diagnosticos', icone: <ClipboardList className="h-4 w-4 flex-shrink-0" /> },
    ],
  },
  {
    // "Contas Lotti", não "Clientes": cliente, neste produto, é a pessoa que o
    // corretor atende no CRM. Misturar os dois nomes no mesmo painel é o erro
    // que faz alguém procurar um comprador de imóvel na lista de assinantes.
    titulo: 'Operação SaaS',
    itens: [
      { recurso: 'usuarios', label: 'Contas Lotti', href: '/admin/usuarios', icone: <Users className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'assinaturas', label: 'Assinaturas', href: '/admin/assinaturas', icone: <CreditCard className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'pagamentos', label: 'Pagamentos', href: '/admin/pagamentos', icone: <Banknote className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'cancelamentos', label: 'Cancelamentos', href: '/admin/cancelamentos', icone: <MessageSquareX className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'onboarding', label: 'Atendimento', href: '/admin/onboarding', icone: <ListChecks className="h-4 w-4 flex-shrink-0" /> },
    ],
  },
  {
    titulo: 'Programa de parceiros',
    itens: [
      { recurso: 'parceiros', label: 'Parceiros', href: '/admin/parceiros', icone: <Handshake className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'comissoes', label: 'Comissões', href: '/admin/comissoes', icone: <Receipt className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'repasses', label: 'Repasses', href: '/admin/repasses', icone: <Send className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'receita', label: 'Receita', href: '/admin/receita', icone: <Wallet className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'campanha', label: 'Campanha', href: '/admin/campanha', icone: <Megaphone className="h-4 w-4 flex-shrink-0" /> },
    ],
  },
  {
    titulo: 'Sistema',
    itens: [
      { recurso: 'integracoes', label: 'Integrações', href: '/admin/integracoes', icone: <PlugZap className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'auditoria', label: 'Auditoria', href: '/admin/auditoria', icone: <ScrollText className="h-4 w-4 flex-shrink-0" /> },
      { recurso: 'configuracoes', label: 'Configurações', href: '/admin/configuracoes', icone: <Settings className="h-4 w-4 flex-shrink-0" /> },
    ],
  },
];

function Navegacao({ aoNavegar }: { aoNavegar?: () => void }) {
  const { pathname } = useLocation();
  const { podeAcessar, ehSuperAdmin } = usePapeis();

  const ativo = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Link to="/admin" className="flex items-center gap-2 text-foreground" onClick={aoNavegar}>
          <LottiLogo variant="full" className="text-xl" />
        </Link>
        {/* O token --gold existia no tema desde sempre e nunca havia sido usado.
            É o que marca "área administrativa" sem inventar cor nova. */}
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-gold">
          Back office
        </p>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4" aria-label="Navegação do back office">
        {GRUPOS.map((grupo, indice) => {
          // Um grupo cujos itens o papel nao alcanca some inteiro, com titulo:
          // cabecalho sobre lista vazia sugere que falta carregar algo.
          const visiveis = grupo.itens.filter((item) => podeAcessar(item.recurso));
          if (visiveis.length === 0) return null;

          return (
            <div key={grupo.titulo ?? `grupo-${indice}`} className="space-y-1">
              {grupo.titulo && (
                <p className="px-3 pt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {grupo.titulo}
                </p>
              )}
              {visiveis.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={aoNavegar}
                  aria-current={ativo(item.href) ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground',
                    'transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    ativo(item.href) &&
                      'bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-sm ring-1 ring-border/50 [&_svg]:text-gold',
                  )}
                >
                  {item.icone}
                  <span className="truncate">{item.label}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-sidebar-border p-3">
        {ehSuperAdmin && (
          <p className="px-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            Super admin
          </p>
        )}
        <Link
          to="/"
          onClick={aoNavegar}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4 flex-shrink-0" />
          <span>Voltar ao app</span>
        </Link>
      </div>
    </div>
  );
}

export function AdminSidebar() {
  const [abertoMobile, setAbertoMobile] = useState(false);

  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-60 flex-shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        <Navegacao />
      </aside>

      {/* Mobile: barra superior + gaveta */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 py-3 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAbertoMobile(true)}
          aria-label="Abrir menu do back office"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <LottiLogo variant="full" className="text-lg" />
        <span className="text-[11px] uppercase tracking-[0.14em] text-gold">Back office</span>
      </div>

      {abertoMobile && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setAbertoMobile(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-64 bg-sidebar shadow-xl">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-3 z-10"
              onClick={() => setAbertoMobile(false)}
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </Button>
            <Navegacao aoNavegar={() => setAbertoMobile(false)} />
          </div>
        </div>
      )}
    </>
  );
}
