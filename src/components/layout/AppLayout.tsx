import { Outlet, useLocation } from 'react-router-dom';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
import { AIChatWidget } from '../ai/AIChatWidget';

export function AppLayout() {
  const { pathname } = useLocation();
  // A página /assistente já é o chat em tela cheia — o widget flutuante em cima
  // dela vira ruído visual redundante.
  const showChatWidget = !pathname.startsWith('/assistente');

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden relative selection:bg-primary/20">
      <AppSidebar />
      {/* Fundo secundário suave (#F8F9F6) para separar a sidebar branca dos
          cards brancos — mantém a leitura leve sem faixa dura de contraste. */}
      <main className="flex-1 h-full overflow-y-auto bg-secondary">
        <div className="container py-8 px-4 md:px-8 max-w-7xl mx-auto animate-fade-in-up">
          {/* Suspense aqui: a sidebar fica fixa enquanto a página (lazy) carrega */}
          <Suspense fallback={
            <div className="flex h-[60vh] w-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          }>
            <Outlet />
          </Suspense>
        </div>
      </main>
      {showChatWidget && <AIChatWidget />}
    </div>
  );
}
