import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';
import { Checkbox } from '@/components/ui/checkbox';
import { PainelInstitucional } from '@/components/auth/PainelInstitucional';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { nomeParceiroIndicador } from '@/lib/admin/atribuicao';
import { loginSchema } from '@/lib/auth/validacao';
import { extrairErroDeRetornoAuth } from '@/lib/auth/retorno';
import { mensagemDeAuth } from '@/lib/auth/mensagens';

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, isAuthenticated, loading: authLoading } = useAuth();
  
  const [isLoading, setIsLoading] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  // 'Lembrar de mim' guarda so o e-mail para pre-preencher: a sessao ja persiste
  // pelo cliente Supabase. Prometer mais que isso seria enganoso.
  const [lembrar, setLembrar] = useState(true);
  
  // Login form
  const [loginEmail, setLoginEmail] = useState(() => localStorage.getItem('lotti:ultimo-email') ?? '');
  const [loginPassword, setLoginPassword] = useState('');

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  // Lido uma vez na montagem: é só rótulo, e não precisa reagir a mudanças.
  const [parceiroIndicador] = useState(() => nomeParceiroIndicador());

  // O AdminRoute devolve para cá com state.from = /admin quando não há sessão.
  const indoParaAdmin = from.startsWith('/admin');

  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, authLoading, navigate, from]);

  // O provedor volta para /auth também quando a pessoa cancela ou quando há
  // erro de configuração. Traduzimos a falha e limpamos os parâmetros para que
  // ela não reapareça ao atualizar a página.
  useEffect(() => {
    const erro = extrairErroDeRetornoAuth(location.search, location.hash);
    if (!erro) return;

    toast.error(mensagemDeAuth(
      erro,
      'Não foi possível entrar com Google. Tente novamente ou use e-mail e senha.',
    ));
    navigate(location.pathname, { replace: true, state: location.state });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const validated = loginSchema.parse({ email: loginEmail, password: loginPassword });
      setIsLoading(true);
      
      const r = await signIn(validated.email, validated.password);

      if (!r.ok) {
        toast.error(r.erro);
        return;
      }

      // "Lembrar de mim" controla apenas o e-mail pré-preenchido. A sessão em
      // si já persiste no localStorage pelo cliente Supabase — prometer mais
      // que isso seria enganoso.
      if (lembrar) localStorage.setItem('lotti:ultimo-email', validated.email);
      else localStorage.removeItem('lotti:ultimo-email');

      toast.success('Bem-vindo de volta!');
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else {
        toast.error('Erro ao fazer login');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    // Duas colunas no desktop; no celular só o formulário — quem abre o login
    // quer entrar, não ler material institucional.
    <div className="min-h-dvh grid bg-background lg:h-dvh lg:grid-cols-2 lg:overflow-hidden">
      <div className="flex items-center justify-center p-4 lg:min-h-0 lg:px-10 lg:py-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-4 flex flex-col items-center lg:mb-3">
          <LottiLogo variant="full" className="text-4xl" />
        </div>

        {/* Sem isto o clique em "Acesso administrativo" era invisível: quem
            está deslogado ia para /admin, o guard devolvia para /auth, e a tela
            final era idêntica à inicial — parecia botão quebrado. O destino
            continua guardado em location.state, então o login leva direto ao
            painel. */}
        {indoParaAdmin && (
          <div className="mb-4 rounded-md border border-gold/30 bg-gold/5 px-4 py-3">
            <p className="text-sm font-medium">Acesso administrativo</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Entre com sua conta. Se ela tiver permissão administrativa, você vai direto
              para o back office.
            </p>
          </div>
        )}

        {/* Quem chegou pelo link de um parceiro merece saber. O nome é só
            rótulo: o vínculo real foi gravado no servidor no momento do clique,
            e é de lá que a atribuição sai — não daqui. */}
        {parceiroIndicador && (
          <div className="mb-4 rounded-md border border-border/60 bg-muted/40 px-4 py-3 text-center">
            <p className="text-sm text-muted-foreground">
              Você chegou pela indicação de{' '}
              <span className="font-medium text-foreground">{parceiroIndicador}</span>
            </p>
          </div>
        )}

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="p-4 pb-3 lg:px-5 lg:pt-5">
            <CardTitle className="text-xl">Bem-vindo de volta!</CardTitle>
            <CardDescription>
              Entre com suas credenciais para acessar o sistema
            </CardDescription>
          </CardHeader>

          <CardContent className="p-4 pt-0 lg:px-5 lg:pb-5">
            <form onSubmit={handleLogin} className="space-y-3.5">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="pl-10"
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password">Senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="login-password"
                    type={mostrarSenha ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="pl-10 pr-10"
                    disabled={isLoading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenha((v) => !v)}
                    aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                  >
                    {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox
                    checked={lembrar}
                    onCheckedChange={(v) => setLembrar(v === true)}
                    disabled={isLoading}
                  />
                  Lembrar de mim
                </label>
                <Link
                  to="/recuperar-senha"
                  className="text-sm text-primary hover:underline"
                >
                  Esqueci minha senha
                </Link>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  'Entrar'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          Ao continuar, você concorda com nossos{' '}
          <Link className="font-medium text-foreground underline underline-offset-2" to="/termos-de-uso">Termos de Uso</Link>
          {' '}e{' '}
          <Link className="font-medium text-foreground underline underline-offset-2" to="/politica-de-privacidade">Política de Privacidade</Link>
        </p>

      </div>
      </div>

      <PainelInstitucional />
    </div>
  );
}
