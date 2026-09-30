import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home, Users, Building2, Filter, KeyRound, Wallet, Scale, Video, QrCode,
  Sparkles, Settings, ChevronLeft, ChevronRight,
  LogOut, Sun, Moon, KanbanSquare, CalendarCheck2, MessageCircle, Cable, Bot, Send,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { FLAGS } from '@/lib/flags';
import { LottiLogo, LottiMark } from '@/components/brand/LottiLogo';
import { useAuth } from '@/hooks/useAuth';
import { useCRMStore } from '@/stores/crmStore';
import { Button } from '@/components/ui/button';
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
        { label: 'Planejamento', href: '/rotina', icone: <CalendarCheck2 className={ic} /> },
      ],
    },
    {
      titulo: 'WhatsApp',
      itens: [
        { label: 'Conversas', href: '/whatsapp', icone: <MessageCircle className={ic} /> },
        // O CRM é o dono do pipeline quando ligado; /funil vira atalho para ele.
        FLAGS.crm
          ? { label: 'Funil de Vendas', href: '/crm', icone: <KanbanSquare className={ic} /> }
          : { label: 'Funil de Vendas', href: '/funil', icone: <Filter className={ic} /> },
        { label: 'Conexão', href: '/whatsapp/conexao', icone: <Cable className={ic} /> },
      ],
    },
    {
      titulo: 'Automações',
      itens: [
        { label: 'Agente de IA', href: '/whatsapp/agente', icone: <Bot className={ic} /> },
        { label: 'Disparos', href: '/automacoes', icone: <Send className={ic} /> },
      ],
    },
    {
      titulo: 'Cadastros',
      itens: [
        { label: 'Clientes', href: '/clientes', icone: <Users className={ic} /> },
        { label: 'Imóveis', href: '/imoveis', icone: <Building2 className={ic} /> },
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
      titulo: 'Sistema',
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
        // Mesmo verde dos blocos de ícone (--surface-brand), agora que ele é
        // um tom claro do esmeralda da marca e não mais o limão de matiz 82.
        // A barra à esquerda continua marcando onde se está.
        ativo
          ? cn(
              'relative bg-surface-brand font-semibold text-primary',
              'before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1',
              'before:-translate-y-1/2 before:rounded-r-full before:bg-primary',
            )
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
  const { signOut, user } = useAuth();
  const { corretor } = useCRMStore();
  const { theme, setTheme } = useTheme();

  const grupos = montarGrupos();
  const itemAtivo = grupos
    .flatMap(grupo => grupo.itens)
    .filter(item => item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

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
          <div key={grupo.titulo} role="group" aria-label={`Seção ${grupo.titulo}`}>
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
                  ativo={item.href === itemAtivo}
                  recolhida={recolhida}
                  aoNavegar={aoNavegar}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        {recolhida ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-center rounded-lg p-1 transition-colors duration-150 hover:bg-sidebar-accent focus-ring"
                aria-label="Menu do usuário"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {iniciais(corretor?.nome)}
                </span>
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
        ) : (
          /* Expandido, a conta fica aberta: sair e tema eram duas ações de uso
             diário escondidas atrás de um menu que ninguém abria. */
          <div className="rounded-lg border border-border p-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {iniciais(corretor?.nome)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {corretor?.nome ?? 'Minha conta'}
                </span>
                {user?.email && (
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                )}
                <span className="block truncate text-xs text-muted-foreground">Corretor</span>
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => void signOut()}>
                <LogOut className="mr-1.5 h-4 w-4" />
                Sair
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export function AppSidebar() {
  const [recolhida, setRecolhida] = useState(false);
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

  return (
    /* Desktop: sidebar fixa em coluna lateral. Mobile: hidden — navegação
       fica com MobileTopBar (topo) + MobileBottomNav (rodapé). */
    <aside
      className={cn(
        'group/sidebar relative hidden shrink-0 border-r border-sidebar-border md:block',
        'transition-[width] duration-200',
        recolhida ? 'w-[4.5rem]' : 'w-sidebar-sm xl:w-sidebar',
      )}
    >
      {/* A alça vive na borda da coluna, no meio da altura: é o gesto de
          empurrar a própria divisória. No topo disputava com a marca e no
          rodapé, com as ações da conta. */}
      <div className="sticky top-0 h-screen">
        <div className="relative h-full">
          <Conteudo recolhida={recolhida} />
          <button
            type="button"
            onClick={alternar}
            className={cn(
              'group absolute -right-3 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2',
              'items-center justify-center rounded-full border border-sidebar-border',
              'bg-background text-muted-foreground shadow-sm',
              'opacity-60 transition-opacity duration-150 focus-ring',
              'hover:text-foreground hover:opacity-100 focus-visible:opacity-100',
              'group-hover/sidebar:opacity-100',
            )}
            aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
          >
            {recolhida ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
