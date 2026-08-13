import { Sidebar, SidebarBody, SidebarLink } from '@/components/ui/sidebar';
import { Home, Users, Building2, Filter, Scale, Settings, Video, LogOut, Wallet, Sparkles, QrCode, Moon, Sun, KeyRound } from 'lucide-react';
import { useTheme } from 'next-themes';
import { FLAGS } from '@/lib/flags';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { cn } from '@/lib/utils';
import { Link, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';
import { useEffect } from 'react';
import { preloadAllSidebarRoutes, preloadRoute } from '@/lib/routePreloaders';

export function AppSidebar() {
  // Menu sempre aberto e fixo. Bloqueamos setOpen (noop) porque o
  // DesktopSidebar dispara setOpen(false) no onMouseLeave — sem isso o
  // hover ainda encolheria a barra e esconderia os rótulos.
  const open = true;
  const setOpen = () => {};
  const { signOut, user } = useAuth();
  const { pathname } = useLocation();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void preloadAllSidebarRoutes();
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const links = [
    { label: 'Início', href: '/', icon: <Home className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Clientes', href: '/clientes', icon: <Users className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Imóveis', href: '/imoveis', icon: <Building2 className="h-5 w-5 flex-shrink-0" /> },
    // Com o CRM ligado ele substitui o funil clássico — um lugar só para pipeline.
    FLAGS.crm
      ? { label: 'Funil de Vendas', href: '/crm', icon: <Filter className="h-5 w-5 flex-shrink-0" /> }
      : { label: 'Funil de Vendas', href: '/funil', icon: <Filter className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Aluguéis', href: '/alugueis', icon: <KeyRound className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Financeiro', href: '/financeiro', icon: <Wallet className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Jurídico', href: '/juridico', icon: <Scale className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Mídias', href: '/midias', icon: <Video className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Fachadas', href: '/fachadas', icon: <QrCode className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Assistente IA', href: '/assistente', icon: <Sparkles className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Configurações', href: '/configuracoes', icon: <Settings className="h-5 w-5 flex-shrink-0" /> },
  ];

  return (
    <TooltipProvider>
      <Sidebar open={open} setOpen={setOpen} animate={false}>
        <SidebarBody className="justify-between gap-6 bg-sidebar border-r border-sidebar-border px-0 py-0">
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Cabeçalho: logo maior, puxada para cima, com divisor abaixo */}
            <div className="flex items-center justify-center pt-4 pb-4 border-b border-sidebar-border dark:border-sidebar-border">
              <Logo open={open} />
            </div>
            <div className="mt-3 flex flex-col gap-1 px-3">
              {links.map((link) => (
                <SidebarLink
                  key={link.href}
                  link={link}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  onPointerEnter={() => void preloadRoute(link.href)}
                  onFocus={() => void preloadRoute(link.href)}
                  className={cn(
                    "relative text-sidebar-foreground/80 hover:bg-[#F3F4F3] hover:text-sidebar-foreground rounded-lg px-4 py-2.5 text-[15px]",
                    "!transition-none group flex items-center w-full",
                    // Estado ativo: pastilha inteira em verde-escuro da marca,
                    // texto e ícone brancos — mesmo tratamento do Clix.
                    isActive(link.href) && [
                      "bg-[#F6FFE7] text-primary font-medium",
                      "[&_svg]:text-primary",
                      "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-primary",
                      "hover:bg-[#F6FFE7] hover:text-primary",
                    ]
                  )}
                />
              ))}
            </div>
          </div>

          {/* Footer — identidade do usuário (email + papel) + botão Sair. */}
          <div className="px-4 pb-4 pt-3 space-y-3 border-t border-sidebar-border">
            {open && user?.email && (
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-primary truncate">
                  {user.email}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
                  Usuário
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={signOut}
                aria-label="Sair da conta"
                className={cn(
                  "flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-sidebar-border bg-background",
                  "text-sm font-medium text-foreground py-2 px-3",
                  "hover:bg-[#F3F4F3] hover:text-sidebar-foreground hover:border-primary/30",
                  "transition-colors"
                )}
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
              <ThemeToggle />
            </div>
          </div>
        </SidebarBody>
      </Sidebar>
    </TooltipProvider>
  );
}

/**
 * Alternador tema claro/escuro — botão quadrado ao lado do Sair, igual ao
 * padrão do Clix. O ícone segue o tema resolvido (Sun no dark, Moon no light)
 * para sinalizar para o que o clique alterna.
 */
const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      title={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className={cn(
        "inline-flex items-center justify-center rounded-lg border border-sidebar-border bg-background",
        "h-9 w-9 text-foreground",
        "hover:bg-[#F3F4F3] hover:text-sidebar-foreground hover:border-primary/30",
        "transition-colors"
      )}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
};

const Logo = ({ open }: { open: boolean }) => {
  return (
    <div className="font-normal flex items-center justify-center text-sm relative z-20 w-full">
      <Link to="/" className="flex w-full items-center justify-center text-primary">
        {open ? (
          <LottiLogo variant="full" className="leading-none" />
        ) : (
          <LottiLogo variant="mark" className="h-8 w-auto" />
        )}
      </Link>
    </div>
  );
};
