import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useOnboarding } from '@/hooks/useOnboarding';
import { deveAbrirOnboarding } from '@/lib/onboarding/contexto';

export function OnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { contexto, carregando, erro } = useOnboarding();

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary">
        <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          Preparando sua operação...
        </div>
      </div>
    );
  }

  // Falha de telemetria/onboarding nunca fecha o acesso ao CRM.
  if (!erro && deveAbrirOnboarding(contexto, location.pathname)) {
    return <Navigate to="/onboarding" replace state={{ returnTo: location.pathname }} />;
  }

  return <>{children}</>;
}
