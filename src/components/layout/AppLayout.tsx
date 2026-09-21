import { Outlet, useLocation } from 'react-router-dom';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
import { MobileTopBar } from './MobileTopBar';
import { MobileBottomNav } from './MobileBottomNav';
import { AIChatWidget } from '../ai/AIChatWidget';
import { OnboardingTour } from '../onboarding/OnboardingTour';
import { useGoogleCalendarReturn } from '@/hooks/routine/useGoogleCalendarReturn';
import { shouldShowAIChatWidget } from './appLayoutRules';

export function AppLayout() {
  const { pathname } = useLocation();
  // A página /assistente já é o chat em tela cheia — o widget flutuante em cima
  // dela vira ruído visual redundante.
  const showChatWidget = shouldShowAIChatWidget(pathname);

  // A volta do consentimento do Google pode cair em qualquer rota protegida:
  // o destino vem de um secret do servidor, não do cliente. Tratar aqui evita
  // que o aviso dependa de a pessoa parar na página certa.
  useGoogleCalendarReturn();

  return (
    // `min-h-screen` com rolagem no documento, não `h-screen` com rolagem
    // interna: o container com altura fixa quebrava o scroll do iOS e impedia
    // a barra de endereço de recolher.
    <div className="flex min-h-screen w-full bg-background selection:bg-primary/15">
      {/* Desktop: sidebar lateral fixa. Mobile: hidden (navegação via bottom nav) */}
      <AppSidebar />

      {/* Mobile: barra superior com logo + notificações */}
      <MobileTopBar />

      {/* Fundo secundário suave (#F8F9F6) para separar a sidebar branca dos
          cards brancos — mantém a leitura leve sem faixa dura de contraste.
          Vem da identidade visual da main e é preservado. */}
      <main className="min-w-0 flex-1 bg-secondary">
        {/*
          pt-20: compensa a barra fixa do topo no mobile (h-14 = 56px + folga).
          pb-24: reserva espaço para a bottom nav no mobile (h-16 = 64px + safe-area).
          md:pt-8 / md:pb-16: valores originais para desktop; a bottom nav é
          md:hidden então o padding extra não prejudica o desktop.
        */}
        <div className="mx-auto w-full max-w-[1600px] px-5 pb-24 pt-20 md:px-8 md:pb-16 md:pt-8">
          {/* Suspense aqui: a sidebar fica fixa enquanto a página (lazy) carrega */}
          <Suspense
            fallback={
              <div className="flex h-[60vh] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </main>

      {showChatWidget && <AIChatWidget />}
      <OnboardingTour />

      {/* Mobile: barra de navegação inferior — visível apenas em < md */}
      <MobileBottomNav />
    </div>
  );
}
