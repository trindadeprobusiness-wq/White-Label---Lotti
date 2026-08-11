import { Sidebar, SidebarBody, SidebarLink, useSidebar } from '@/components/ui/sidebar';
import { Home, Users, Building2, BarChart3, Scale, Settings, Sun, Moon, Video, LogOut, Wallet, Sparkles, QrCode, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { cn } from '@/lib/utils';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';
import { useCRMStore } from '@/stores/crmStore';

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  const { signOut } = useAuth();
  const { pathname } = useLocation();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const links = [
    { label: 'Início', href: '/', icon: <Home className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Clientes', href: '/clientes', icon: <Users className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Imóveis', href: '/imoveis', icon: <Building2 className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Funil de Vendas', href: '/funil', icon: <BarChart3 className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Aluguéis', href: '/alugueis', icon: <Building2 className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Financeiro', href: '/financeiro', icon: <Wallet className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Jurídico', href: '/juridico', icon: <Scale className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Mídias', href: '/midias', icon: <Video className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Fachadas', href: '/fachadas', icon: <QrCode className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Assistente IA', href: '/assistente', icon: <Sparkles className="h-5 w-5 flex-shrink-0" /> },
    { label: 'Configurações', href: '/configuracoes', icon: <Settings className="h-5 w-5 flex-shrink-0" /> },
  ];

  return (
    <TooltipProvider>
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-10 bg-sidebar border-r border-sidebar-border">
          <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
            <div className="relative flex items-center justify-center py-2">
              <Logo open={open} />
              <PinButton />
            </div>
            <div className="mt-8 flex flex-col gap-1 px-2">
              {links.map((link) => (
                <SidebarLink
                  key={link.href}
                  link={link}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  className={cn(
                    "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground rounded-md px-3 py-2.5",
                    "transition-all duration-300 ease-out group flex items-center w-full",
                    isActive(link.href) &&
                      "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm ring-1 ring-border/50 [&_svg]:text-primary"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Footer with Theme Toggle and Logout */}
          <div className="border-t border-sidebar-border pt-4 pb-2 space-y-2">
            <ThemeToggleButton open={open} />
            <LogoutButton open={open} onLogout={signOut} />
          </div>
        </SidebarBody>
      </Sidebar>
    </TooltipProvider>
  );
}

const Logo = ({ open }: { open: boolean }) => {
  return (
    <div className="font-normal flex items-center justify-center text-sm relative z-20 px-1 w-full">
      <Link to="/" className='flex items-center justify-center w-full text-foreground'>
        {open ? (
          <LottiLogo variant="full" className="text-2xl md:text-[1.7rem] mt-2 transition-all duration-300" />
        ) : (
          <LottiLogo variant="mark" className="h-7 w-auto mt-1 transition-all duration-300" />
        )}
      </Link>
    </div>
  );
};

const PinButton = () => {
  const { isPinned, setIsPinned, open } = useSidebar();
  
  if (!open) return null;
  
  return (
    <button 
      onClick={() => setIsPinned(!isPinned)}
      className="absolute right-0 top-1 p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-all z-30 ring-1 ring-border/50 bg-background shadow-sm"
      title={isPinned ? "Desafixar menu" : "Fixar menu"}
    >
      {isPinned ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
    </button>
  );
};

const ThemeToggleButton = ({ open }: { open: boolean }) => {
  const { resolvedTheme, setTheme } = useTheme();
  const updatePreferencias = useCRMStore((s) => s.updatePreferencias);
  const isDark = resolvedTheme === 'dark';

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    setTheme(next);
    // Espelha no store para manter o seletor de Configurações consistente.
    updatePreferencias({ tema: next });
  };

  const button = (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className={cn(
        "flex items-center gap-2 py-2 px-2 rounded-md w-full",
        "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "transition-all duration-200"
      )}
    >
      {isDark ? (
        <Sun className="h-5 w-5 flex-shrink-0 text-amber-400" />
      ) : (
        <Moon className="h-5 w-5 flex-shrink-0 text-indigo-400" />
      )}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        className="whitespace-pre overflow-hidden"
      >
        {isDark ? 'Tema Claro' : 'Tema Escuro'}
      </motion.span>
    </button>
  );

  if (!open) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {button}
        </TooltipTrigger>
        <TooltipContent side="right">
          {isDark ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
};

const LogoutButton = ({ open, onLogout }: { open: boolean; onLogout: () => void }) => {
  const button = (
    <button
      onClick={onLogout}
      aria-label="Sair da conta"
      className={cn(
        "flex items-center gap-2 py-2 px-2 rounded-md w-full",
        "text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive",
        "transition-all duration-200"
      )}
    >
      <LogOut className="h-5 w-5 flex-shrink-0" />
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        className="whitespace-pre overflow-hidden"
      >
        Sair
      </motion.span>
    </button>
  );

  if (!open) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {button}
        </TooltipTrigger>
        <TooltipContent side="right">
          Sair da conta
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
};
