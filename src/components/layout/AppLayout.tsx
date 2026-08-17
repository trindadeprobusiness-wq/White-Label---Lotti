import { Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
import { AIChatWidget } from '../ai/AIChatWidget';

export function AppLayout() {
  return (
    // `min-h-screen` com rolagem no documento, não `h-screen` com rolagem
    // interna: o container com altura fixa quebrava o scroll do iOS e impedia
    // a barra de endereço de recolher.
    <div className="flex min-h-screen w-full bg-background selection:bg-primary/15">
      <AppSidebar />
      <main className="min-w-0 flex-1">
        {/* pt-20 no mobile compensa a barra fixa da sidebar; o padding lateral
            acompanha a densidade das referências (20px → 32px). */}
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
      <AIChatWidget />
    </div>
  );
}
