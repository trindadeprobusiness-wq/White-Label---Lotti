import { Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminSidebar } from './AdminSidebar';

/**
 * Shell do back office.
 *
 * Não passa pelo DataLoader de propósito: aquele carrega clientes, imóveis,
 * contratos e alertas do corretor logado antes de desenhar qualquer coisa —
 * caro e irrelevante aqui, onde nada disso é usado.
 */
export function AdminLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background selection:bg-primary/20">
      <AdminSidebar />
      <main className="h-full flex-1 overflow-y-auto bg-background/50">
        {/* pt-16 no mobile compensa a barra superior fixa da AdminSidebar. */}
        <div className="container mx-auto max-w-7xl px-4 pb-12 pt-20 md:px-8 md:pt-8">
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
    </div>
  );
}
