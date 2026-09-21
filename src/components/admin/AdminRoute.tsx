import { Navigate, useLocation, Link } from 'react-router-dom';
import { Loader2, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { usePapeis } from '@/hooks/admin/usePapeis';
import type { Recurso } from '@/lib/admin/permissoes';

interface AdminRouteProps {
  children: React.ReactNode;
  /** Quando informado, exige permissão para o recurso além do papel. */
  recurso?: Recurso;
}

/**
 * Guard do back office. Espelha ProtectedRoute, mas checa papel além de sessão.
 *
 * Isto NÃO é a autorização — é a navegação. Quem forjar a rota no cliente chega
 * a uma tela que não consegue carregar dado nenhum: toda RPC do painel levanta
 * `acesso negado` e as tabelas novas exigem `is_admin()` na RLS.
 */
export function AdminRoute({ children, recurso }: AdminRouteProps) {
  const { isAuthenticated, loading: carregandoSessao } = useAuth();
  const { ehAdmin, podeAcessar, carregando, naoInstalado } = usePapeis();
  const location = useLocation();

  if (carregandoSessao || carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando acesso...</p>
        </div>
      </div>
    );
  }

  // Sem sessão: manda para o login guardando o destino, para voltar direto ao
  // painel depois de autenticar. É isto que faz o link "Acesso administrativo"
  // da tela de login funcionar sem um segundo formulário.
  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Back office ainda não instalado no banco. Aqui a tela explica, em vez de
  // redirecionar: não é falta de permissão, é falta de migration, e mandar o
  // operador de volta ao dashboard esconderia a única informação útil.
  // Não vaza nada: quem chega aqui já está autenticado, e a mensagem fala do
  // estado do schema, não de quem tem acesso.
  if (naoInstalado) {
    return <BackOfficeNaoInstalado />;
  }

  // Autenticado sem papel vai para a aplicação normal, não para uma tela de
  // "acesso negado": confirmar que /admin existe é informação que um corretor
  // comum não precisa ter.
  if (!ehAdmin) {
    return <Navigate to="/" replace />;
  }

  if (recurso && !podeAcessar(recurso)) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}

/**
 * Tela de diagnóstico para quando as migrations não foram aplicadas.
 *
 * Diz exatamente o que fazer e em que ordem. Sem isto, o sintoma que chega ao
 * operador é "cliquei e não aconteceu nada" — que não aponta para lugar nenhum.
 */
function BackOfficeNaoInstalado() {
  const arquivos = [
    '20260814100000_admin_papeis_auditoria.sql',
    '20260814110000_atividade_e_config.sql',
    '20260814120000_parceiros_atribuicao.sql',
    '20260814130000_receita_comissoes.sql',
    '20260814140000_admin_rpcs.sql',
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl rounded-lg border border-warning/40 bg-warning/5 p-6">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
          <div className="min-w-0">
            <h1 className="font-serif text-lg font-semibold">
              Back office ainda não instalado
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              As tabelas e funções do painel administrativo ainda não existem neste banco.
              O código está pronto; falta aplicar as migrations no Supabase.
            </p>

            <ol className="mt-4 space-y-3 text-sm">
              <li>
                <span className="font-medium">1. Aplique as migrations</span>
                <p className="mt-1 text-muted-foreground">
                  No SQL Editor do Supabase, cole e execute os arquivos abaixo{' '}
                  <span className="font-medium">nesta ordem</span>. Eles também estão
                  prontos em <code className="text-xs">deploy-manual/backoffice-*.sql</code>.
                </p>
                <ul className="mt-2 space-y-1">
                  {arquivos.map((a) => (
                    <li key={a} className="font-mono text-xs text-muted-foreground">
                      supabase/migrations/{a}
                    </li>
                  ))}
                </ul>
              </li>

              <li>
                <span className="font-medium">2. Promova o primeiro administrador</span>
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
{`SELECT public.promover_primeiro_super_admin('seu@email.com');`}
                </pre>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use o e-mail de uma conta que já exista na Lotti.
                </p>
              </li>

              <li>
                <span className="font-medium">3. Recarregue esta página</span>
              </li>
            </ol>

            <p className="mt-4 text-xs text-muted-foreground">
              Passo a passo completo em <code>docs/BACKOFFICE.md</code>.
            </p>

            <div className="mt-5 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Já apliquei — recarregar
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/">Voltar ao app</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
