import { Link, useLocation } from 'react-router-dom';
import {
  Wallet, Scale, Video, QrCode, Sparkles, Settings,
  CalendarCheck2, Building2, CreditCard, LogOut, Sun, Moon, Cable,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { LottiMark } from '@/components/brand/LottiLogo';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';

/**
 * Sheet inferior ("Mais") da Bottom Navigation mobile.
 *
 * Agrupa as rotas secundárias do sistema (Gestão + Sistema) num painel
 * que desliza de baixo para cima — padrão Instagram/WhatsApp para overflow
 * de navegação. As 5 rotas principais ficam na Bottom Nav; o restante aqui.
 */

interface ItemSheet {
  label: string;
  href: string;
  icone: React.ReactNode;
}

const ic = 'h-6 w-6';

function itensMenu(): ItemSheet[] {
  return [
    { label: 'Financeiro',   href: '/financeiro',  icone: <Wallet className={ic} /> },
    { label: 'Jurídico',     href: '/juridico',    icone: <Scale className={ic} /> },
    { label: 'Mídias',       href: '/midias',      icone: <Video className={ic} /> },
    { label: 'Fachadas',     href: '/fachadas',    icone: <QrCode className={ic} /> },
    { label: 'Imóveis',      href: '/imoveis',     icone: <Building2 className={ic} /> },
    { label: 'Rotina',       href: '/rotina',      icone: <CalendarCheck2 className={ic} /> },
    { label: 'Conexão WhatsApp', href: '/whatsapp/conexao', icone: <Cable className={ic} /> },
    { label: 'Assistente IA', href: '/assistente', icone: <Sparkles className={ic} /> },
    { label: 'Configurações', href: '/configuracoes', icone: <Settings className={ic} /> },
    { label: 'Meu Plano',     href: '/plano',      icone: <CreditCard className={ic} /> },
  ];
}

interface CardItemProps {
  item: ItemSheet;
  ativo: boolean;
  aoFechar: () => void;
}

function CardItem({ item, ativo, aoFechar }: CardItemProps) {
  return (
    <Link
      to={item.href}
      onClick={aoFechar}
      aria-current={ativo ? 'page' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl p-3 text-center h-24',
        'transition-all duration-150 active:scale-95',
        ativo
          ? 'text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center">
        {item.icone}
      </span>
      <span className={cn(
        'text-[11px] font-medium leading-tight',
        ativo ? 'text-primary' : 'text-foreground',
      )}>
        {item.label}
      </span>
    </Link>
  );
}

interface MobileMoreSheetProps {
  aberto: boolean;
  aoFechar: () => void;
}

export function MobileMoreSheet({ aberto, aoFechar }: MobileMoreSheetProps) {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  const ativo = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const menu = itensMenu();

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent
        side="bottom"
        className={cn(
          'rounded-t-[20px] border-t border-border pb-[env(safe-area-inset-bottom)] px-4',
          'max-h-[85dvh] overflow-y-auto',
        )}
      >
        {/* Handle visual */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />

        <SheetHeader className="mb-6 relative flex items-center justify-center">
          <SheetTitle className="text-lg font-semibold">Menu</SheetTitle>
          
          {/* Ações no topo (Tema e Logout) */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            >
              {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>
            <button
              type="button"
              onClick={() => { aoFechar(); void signOut(); }}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10"
              aria-label="Sair"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </SheetHeader>

        {/* Grade de Menu Unificada */}
        <div className="grid grid-cols-3 gap-y-4 gap-x-2 mb-6">
          {menu.map((item) => (
            <CardItem key={item.href} item={item} ativo={ativo(item.href)} aoFechar={aoFechar} />
          ))}
        </div>

        {/* Rodapé com versão */}
        <div className="mt-auto border-t border-border pt-4">
          <div className="flex w-full items-center justify-center gap-2 py-3 text-xs font-medium text-muted-foreground">
            <LottiMark className="h-4 w-auto text-muted-foreground" decorative />
            <span>Lotti — versão atual</span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
