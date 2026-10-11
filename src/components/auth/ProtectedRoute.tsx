import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { preloadRotaDeEntrada } from '@/lib/routePreloaders';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // Com a sessão confirmada, a tela pedida começa a baixar junto com o onboarding e as listas, em vez de
  // esperar os dois. Só com sessão: quem está deslogado não baixa tela protegida na tela de login.
  useEffect(() => {
    if (isAuthenticated && import.meta.env.PROD) preloadRotaDeEntrada(location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na entrada (ou no login), não a cada troca de tela
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
