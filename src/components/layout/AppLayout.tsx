import { Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
import { AIChatWidget } from '../ai/AIChatWidget';

export function AppLayout() {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden relative">
      <AppSidebar />
      <main className="flex-1 h-full overflow-y-auto">
        <div className="container py-6 px-4 md:px-6 lg:px-8 max-w-7xl">
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
      <AIChatWidget />
    </div>
  );
}
