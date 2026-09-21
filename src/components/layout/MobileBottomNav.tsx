import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home, Users, KeyRound, MoreHorizontal, KanbanSquare, Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FLAGS } from '@/lib/flags';
import { useCRMStore } from '@/stores/crmStore';
import { useAlertasAoVivo } from '@/hooks/useAlertasAoVivo';
import { rotuloContagem, contarNaoLidas } from '@/lib/notificacoes';
import { MobileMoreSheet } from './MobileMoreSheet';

/**
 * Bottom Navigation fixa do mobile — padrão Instagram / WhatsApp.
 *
 * Cinco tabs: Início, Clientes, Pipeline, Aluguéis e "Mais".
 * As rotas secundárias (Financeiro, Jurídico, Mídias, Fachadas, Imóveis,
 * Rotina, Assistente IA, Configurações) ficam no MobileMoreSheet.
 *
 * Regras de design:
 * - Altura fixa de 64px + safe-area do iPhone (env(safe-area-inset-bottom))
 * - Ativa com pill verde embaixo do ícone — padrão Apple HIG
 * - Feedback háptico visual: scale-95 no active
 * - Badge de notificações no Início
 * - Visível APENAS em mobile (< md) — desktop usa a sidebar
 */

const ic = 'h-6 w-6';

interface Tab {
  id: string;
  label: string;
  href?: string;
  icone: React.ReactNode;
  isMore?: boolean;
}

function montarTabs(): Tab[] {
  return [
    {
      id: 'inicio',
      label: 'Início',
      href: '/',
      icone: <Home className={ic} />,
    },
    {
      id: 'clientes',
      label: 'Clientes',
      href: '/clientes',
      icone: <Users className={ic} />,
    },
    {
      id: 'pipeline',
      label: 'Pipeline',
      href: FLAGS.crm ? '/crm' : '/funil',
      icone: FLAGS.crm
        ? <KanbanSquare className={ic} />
        : <Filter className={ic} />,
    },
    {
      id: 'alugueis',
      label: 'Aluguéis',
      href: '/alugueis',
      icone: <KeyRound className={ic} />,
    },
    {
      id: 'mais',
      label: 'Mais',
      icone: <MoreHorizontal className={ic} />,
      isMore: true,
    },
  ];
}

/**
 * Indicador de tab ativa — pill verde inspirado no estilo Apple / Linear.
 * Fica posicionado acima do ícone, não abaixo.
 */
function Pill({ visivel }: { visivel: boolean }) {
  return (
    <span
      className={cn(
        'absolute top-0 h-0.5 w-8 rounded-full bg-primary transition-all duration-200',
        visivel ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden="true"
    />
  );
}

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const [sheetAberto, setSheetAberto] = useState(false);

  // Badge de notificações não lidas — polling mantido ativo pelo hook;
  // os dados ficam no store global carregado pelo DataLoader.
  useAlertasAoVivo();
  const alertas = useCRMStore((s) => s.alertas);
  const { total: naoLidas } = contarNaoLidas(alertas);
  const badge = rotuloContagem(naoLidas);

  const tabs = montarTabs();

  const ativo = (href?: string) => {
    if (!href) return false;
    return href === '/' ? pathname === '/' : pathname.startsWith(href);
  };

  // "Mais" está ativo quando estamos numa rota secundária não coberta pelos 4 tabs
  const rotasPrincipais = tabs
    .filter((t) => !t.isMore && t.href)
    .map((t) => t.href!);

  const maisAtivo =
    !rotasPrincipais.some((r) =>
      r === '/' ? pathname === '/' : pathname.startsWith(r),
    ) && pathname !== '/';

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className={cn(
          'fixed bottom-0 inset-x-0 z-50 md:hidden',
          'flex h-16 items-stretch border-t border-sidebar-border bg-sidebar/95 backdrop-blur-sm',
          // Safe area para o home indicator do iPhone
          'pb-[env(safe-area-inset-bottom)]',
        )}
      >
        {tabs.map((tab) => {
          const eAtivo = tab.isMore ? maisAtivo : ativo(tab.href);

          if (tab.isMore) {
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSheetAberto(true)}
                aria-label="Abrir menu completo"
                aria-expanded={sheetAberto}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-1 pt-1',
                  'transition-all duration-150 active:scale-95',
                  eAtivo ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Pill visivel={eAtivo} />
                <span className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  eAtivo ? 'bg-primary/10' : '',
                )}>
                  {tab.icone}
                </span>
                <span className="text-[10px] font-medium leading-none">{tab.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={tab.id}
              to={tab.href!}
              aria-current={eAtivo ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1 pt-1',
                'transition-all duration-150 active:scale-95',
                eAtivo ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Pill visivel={eAtivo} />

              {/* Ícone com badge de notificação no tab "Início" */}
              <span className="relative flex h-7 w-7 items-center justify-center rounded-lg transition-colors">
                <span className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  eAtivo ? 'bg-primary/10' : '',
                )}>
                  {tab.icone}
                </span>

                {/* Badge apenas no Início, quando há notificações não lidas */}
                {tab.id === 'inicio' && naoLidas > 0 && (
                  <span
                    className={cn(
                      'absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center',
                      'rounded-full bg-destructive px-0.5 text-[9px] font-bold text-destructive-foreground',
                      'leading-none h-4',
                    )}
                    aria-label={`${naoLidas} notificações não lidas`}
                  >
                    {badge}
                  </span>
                )}
              </span>

              <span className="text-[10px] font-medium leading-none">{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Sheet de navegação secundária */}
      <MobileMoreSheet
        aberto={sheetAberto}
        aoFechar={() => setSheetAberto(false)}
      />
    </>
  );
}
