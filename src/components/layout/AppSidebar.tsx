import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home, Users, Building2, Filter, KeyRound, Wallet, Scale, Video, QrCode,
  Sparkles, Settings, ChevronLeft, ChevronRight, ChevronsUpDown,
  LogOut, Sun, Moon, Menu, X, KanbanSquare, CalendarCheck2,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { FLAGS } from '@/lib/flags';
import { LottiLogo, LottiMark } from '@/components/brand/LottiLogo';
import { useAuth } from '@/hooks/useAuth';
import { useCRMStore } from '@/stores/crmStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Navegação lateral da Lotti.
 *
 * Substitui a sidebar que expandia no hover (padrão Aceternity). Numa
 * ferramenta de trabalho, menu que muda de largura sozinho atrapalha: o alvo
 * se move enquanto o cursor viaja, e a hierarquia dos grupos só aparece depois
 * que já se está em cima dela. Aqui a largura é estável e o recolhimento é
 * escolha explícita do usuário, persistida entre sessões.
 */

interface ItemNav {
  label: string;
  href: string;
  icone: React.ReactNode;
}

interface GrupoNav {
  titulo: string;
  itens: ItemNav[];
}

const CHAVE_RECOLHIDA = 'lotti:sidebar-recolhida';
const ic = 'h-[18px] w-[18px] shrink-0';

/**
 * O back office NÃO aparece aqui, nem para quem é admin.
 *
 * Esta é a navegação do produto — o que um corretor usa no dia a dia. O painel
 * administrativo pertence a outro contexto (operação da plataforma) e misturar
 * os dois expõe a existência da área a quem senta ao lado, num compartilhamento
 * de tela ou numa demonstração.
 *
 * O acesso continua em dois caminhos, ambos discretos: o link "Acesso
 * administrativo" no rodapé da tela de login, e `/admin` digitado direto.
 * Nada disso é segurança — quem não tem papel bate no AdminRoute e nas policies
 * do Postgres. É sobre não anunciar.
 */
function montarGrupos(): GrupoNav[] {
  return [
    {
      titulo: 'Operação',
      itens: [
        { label: 'Início', href: '/', icone: <Home className={ic} /> },
        { label: 'Rotina', href: '/rotina', icone: <CalendarCheck2 className={ic} /> },
        { label: 'Clientes', href: '/clientes', icone: <Users className={ic} /> },
        { label: 'Imóveis', href: '/imoveis', icone: <Building2 className={ic} /> },
        // O CRM é o dono do pipeline quando ligado; /funil vira atalho para ele.
        FLAGS.crm
          ? { label: 'Funil de Vendas', href: '/crm', icone: <KanbanSquare className={ic} /> }
          : { label: 'Funil de Vendas', href: '/funil', icone: <Filter className={ic} /> },
        { label: 'Aluguéis', href: '/alugueis', icone: <KeyRound className={ic} /> },
      ],
    },
    {
      titulo: 'Gestão',
      itens: [
        { label: 'Financeiro', href: '/financeiro', icone: <Wallet className={ic} /> },
        { label: 'Jurídico', href: '/juridico', icone: <Scale className={ic} /> },
        { label: 'Mídias', href: '/midias', icone: <Video className={ic} /> },
        { label: 'Fachadas', href: '/fachadas', icone: <QrCode className={ic} /> },
      ],
    },
    {
      titulo: 'Recursos',
      itens: [
        { label: 'Assistente IA', href: '/assistente', icone: <Sparkles className={ic} /> },
        { label: 'Configurações', href: '/configuracoes', icone: <Settings className={ic} /> },
      ],
    },
  ];
}

function iniciais(nome?: string | null): string {
  if (!nome) return 'LO';
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function ItemMenu({
  item, ativo, recolhida, aoNavegar,
}: {
  item: ItemNav; ativo: boolean; recolhida: boolean; aoNavegar?: () => void;
}) {
  const link = (
    <Link
      to={item.href}
      onClick={aoNavegar}
      aria-current={ativo ? 'page' : undefined}
      className={cn(
        'group flex h-nav-item items-center gap-3 rounded-lg px-3 text-sm font-medium',
        'transition-colors duration-150 focus-ring',
        recolhida && 'justify-center px-0',
        ativo
          // Verde sólido, sem sombra: o contraste já separa o item do resto.
          ? 'bg-primary text-primary-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
    >
      {item.icone}
      {!recolhida && <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (!recolhida) return link;

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function Conteudo({
  recolhida, alternarRecolhida, aoNavegar, emDrawer = false,
}: {
  recolhida: boolean;
  alternarRecolhida?: () => void;
  aoNavegar?: () => void;
  emDrawer?: boolean;
}) {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const { corretor } = useCRMStore();
  const { theme, setTheme } = useTheme();

  const grupos = montarGrupos();
  const ativo = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className={cn('flex items-center px-5 pb-2 pt-5', recolhida && 'justify-center px-0 py-5')}>
        <Link to="/" onClick={aoNavegar} className="rounded focus-ring text-primary">
          {recolhida ? (
            <LottiMark className="h-7 w-auto" />
          ) : (
            <LottiLogo variant="full" className="text-[1.65rem] text-primary" />
          )}
        </Link>
      </div>

      {!recolhida && (
        <div role="separator" className="mx-5 border-t border-sidebar-border" />
      )}

      <nav
        className={cn(
          'flex-1 space-y-6 overflow-y-auto px-3 pb-4 pt-2',
          recolhida && 'px-2 pt-0',
        )}
        aria-label="Navegação principal"
      >
        {grupos.map((grupo) => (
          <div key={grupo.titulo}>
            {/* No modo recolhido o rótulo do grupo vira um divisor: o texto
                não caberia e cortá-lo em "OPE..." não comunica nada. */}
            {recolhida ? (
              <div className="mx-2 mb-2 border-t border-sidebar-border" />
            ) : (
              <p className="mb-2 px-3 text-group uppercase text-muted-strong">
                {grupo.titulo}
              </p>
            )}
            <div className="space-y-0.5">
              {grupo.itens.map((item) => (
                <ItemMenu
                  key={item.href}
                  item={item}
                  ativo={ativo(item.href)}
                  recolhida={recolhida}
                  aoNavegar={aoNavegar}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border border-border p-2 text-left',
                'transition-colors duration-150 hover:bg-sidebar-accent focus-ring',
                recolhida && 'justify-center border-0 p-1',
              )}
              aria-label="Menu do usuário"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {iniciais(corretor?.nome)}
              </span>
              {!recolhida && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {corretor?.nome ?? 'Minha conta'}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Corretor
                    </span>
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuItem asChild>
              <Link to="/configuracoes">
                <Settings className="mr-2 h-4 w-4" />
                Configurações
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? (
                <><Sun className="mr-2 h-4 w-4" />Tema claro</>
              ) : (
                <><Moon className="mr-2 h-4 w-4" />Tema escuro</>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void signOut()}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {!emDrawer && alternarRecolhida && (
          <button
            type="button"
            onClick={alternarRecolhida}
            className={cn(
              'mt-2 flex h-nav-item w-full items-center gap-3 rounded-lg px-3 text-sm',
              'text-muted-foreground transition-colors duration-150',
              'hover:bg-sidebar-accent hover:text-foreground focus-ring',
              recolhida && 'justify-center px-0',
            )}
            aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
          >
            {recolhida ? (
              <ChevronRight className={ic} />
            ) : (
              <>
                <ChevronLeft className={ic} />
                <span>Recolher menu</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [recolhida, setRecolhida] = useState(false);
  const [drawerAberto, setDrawerAberto] = useState(false);
  const { pathname } = useLocation();

  // Preferência do usuário sobrevive ao reload — recolher o menu a cada visita
  // seria decidir por ele de novo toda vez.
  useEffect(() => {
    try {
      setRecolhida(localStorage.getItem(CHAVE_RECOLHIDA) === '1');
    } catch { /* sem storage, começa expandida */ }
  }, []);

  const alternar = () => {
    setRecolhida((atual) => {
      const proximo = !atual;
      try { localStorage.setItem(CHAVE_RECOLHIDA, proximo ? '1' : '0'); } catch { /* ok */ }
      return proximo;
    });
  };

  // Navegar fecha o drawer. Sem isto, no mobile o menu fica aberto sobre a
  // página recém-aberta e o usuário precisa fechá-lo à mão.
  useEffect(() => { setDrawerAberto(false); }, [pathname]);

  return (
    <>
      <aside
        className={cn(
          'hidden shrink-0 border-r border-sidebar-border md:block',
          'transition-[width] duration-200',
          recolhida ? 'w-[4.5rem]' : 'w-sidebar-sm xl:w-sidebar',
        )}
      >
        <div className="sticky top-0 h-screen">
          <Conteudo recolhida={recolhida} alternarRecolhida={alternar} />
        </div>
      </aside>

      {/* Mobile: barra superior + gaveta */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerAberto(true)}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-foreground hover:bg-sidebar-accent focus-ring"
          aria-label="Abrir menu"
          aria-expanded={drawerAberto}
        >
          <Menu className="h-5 w-5" />
        </button>
        <LottiLogo variant="full" className="text-xl text-primary" />
      </div>

      {drawerAberto && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setDrawerAberto(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-[17rem] shadow-overlay">
            <button
              type="button"
              onClick={() => setDrawerAberto(false)}
              className="absolute right-2 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent focus-ring"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            <Conteudo recolhida={false} aoNavegar={() => setDrawerAberto(false)} emDrawer />
          </div>
        </div>
      )}
    </>
  );
}
