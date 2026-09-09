import { Outlet, useLocation } from 'react-router-dom';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
import { AIChatWidget } from '../ai/AIChatWidget';
import { OnboardingTour } from '../onboarding/OnboardingTour';
import { shouldShowAIChatWidget } from './appLayoutRules';

export function AppLayout() {
  const { pathname } = useLocation();
  // Páginas que já são experiências de conversa não recebem outro chat por cima.
  const showChatWidget = shouldShowAIChatWidget(pathname);

  return (
    // `min-h-screen` com rolagem no documento, não `h-screen` com rolagem
    // interna: o container com altura fixa quebrava o scroll do iOS e impedia
    // a barra de endereço de recolher.
    <div className="flex min-h-screen w-full bg-background selection:bg-primary/15">
      <AppSidebar />
      {/* Fundo secundário suave (#F8F9F6) para separar a sidebar branca dos
          cards brancos — mantém a leitura leve sem faixa dura de contraste.
          Vem da identidade visual da main e é preservado. */}
      <main className="min-w-0 flex-1 bg-secondary">
        {/* pt-20 no mobile compensa a barra fixa da sidebar. `min-h-screen` no
            pai com rolagem no documento: `h-screen` com overflow interno
            quebrava o scroll do iOS. */}
        <div className="mx-auto w-full max-w-[1600px] px-5 pb-16 pt-20 md:px-8 md:pt-8">
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
    </div>
  );
}
