import { useEffect, useState, type ReactNode } from 'react';
import { ShieldCheck, LogOut } from 'lucide-react';
import { obterSuporte } from '@/lib/admin/suporte';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

export function SuporteBanner() {
  const suporte = obterSuporte();
  const { signOut } = useAuth();
  if (!suporte) return null;
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-y border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
    <div className="flex min-w-0 items-start gap-2">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <div><strong>Atendimento: {suporte.nome}</strong><p className="text-xs">Alterações registradas na auditoria · Até {new Date(suporte.expira_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p></div>
    </div>
    <Button variant="outline" size="sm" onClick={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Encerrar atendimento</Button>
  </div>;
}

export function SuporteBoundary({ children }: { children: ReactNode }) {
  const suporte = obterSuporte();
  const { signOut, isAuthenticated, loading } = useAuth();
  const expiraEm = suporte?.expira_em;
  const [expirado, setExpirado] = useState(() => !!expiraEm && Date.parse(expiraEm) <= Date.now());
  useEffect(() => {
    if (!expiraEm) return;
    const timer = window.setTimeout(() => setExpirado(true), Math.max(0, Date.parse(expiraEm) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiraEm]);
  if (suporte && (expirado || (!loading && !isAuthenticated))) return <div className="mx-auto max-w-lg space-y-4 px-5 py-16">
    <h1 className="text-xl font-semibold">Atendimento encerrado</h1>
    <p className="text-sm text-muted-foreground">Esta sessão não permite mais consultar ou alterar a conta.</p>
    <Button onClick={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Voltar ao backoffice</Button>
  </div>;
  return <>{children}</>;
}
