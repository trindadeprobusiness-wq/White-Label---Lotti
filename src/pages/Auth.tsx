import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, Building2, Mail, Lock, User, Phone, CreditCard, Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';
import { Checkbox } from '@/components/ui/checkbox';
import { PainelInstitucional } from '@/components/auth/PainelInstitucional';
import { BotoesSociais } from '@/components/auth/BotoesSociais';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { nomeParceiroIndicador } from '@/lib/admin/atribuicao';
import { formatarCNPJ } from '@/lib/validators';
import { cadastroSchema, loginSchema } from '@/lib/auth/validacao';
import { extrairErroDeRetornoAuth } from '@/lib/auth/retorno';
import { mensagemDeAuth } from '@/lib/auth/mensagens';

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signUp, isAuthenticated, loading: authLoading } = useAuth();
  
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  // 'Lembrar de mim' guarda so o e-mail para pre-preencher: a sessao ja persiste
  // pelo cliente Supabase. Prometer mais que isso seria enganoso.
  const [lembrar, setLembrar] = useState(true);
  
  // Login form
  const [loginEmail, setLoginEmail] = useState(() => localStorage.getItem('lotti:ultimo-email') ?? '');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Signup form
  const [signupNome, setSignupNome] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupCnpj, setSignupCnpj] = useState('');
  const [signupTelefone, setSignupTelefone] = useState('');

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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const validated = cadastroSchema.parse({
        nome: signupNome,
        email: signupEmail,
        password: signupPassword,
        cnpj: signupCnpj,
        telefone: signupTelefone,
      });
      
      setIsLoading(true);
      
      const r = await signUp(validated.email, validated.password, {
        nome: validated.nome,
        cnpj: validated.cnpj,
        telefone: validated.telefone,
      });

      if (!r.ok) {
        toast.error(r.erro);
        return;
      }

      // Antes dizia sempre "já pode acessar o sistema". Com confirmação de
      // e-mail ligada, o signUp devolve sucesso SEM sessão e o login seguinte
      // falha com "Email not confirmed" — a mensagem era simplesmente falsa.
      if (r.precisaConfirmarEmail) {
        toast.success('Conta criada! Confirme seu e-mail para entrar — veja também o spam.', {
          duration: 8000,
        });
      } else {
        toast.success('Conta criada! Bem-vindo ao Lotti.');
      }
      setActiveTab('login');
      setLoginEmail(validated.email);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else {
        toast.error('Erro ao cadastrar');
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
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="flex items-center justify-center p-4 lg:p-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <LottiLogo variant="full" className="text-4xl mb-4" />
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
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <CardHeader className="pb-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Cadastrar</TabsTrigger>
              </TabsList>
            </CardHeader>

            <CardContent>
              <TabsContent value="login" className="mt-0">
                <CardTitle className="text-xl mb-2">Bem-vindo de volta!</CardTitle>
                <CardDescription className="mb-6">
                  Entre com suas credenciais para acessar o sistema
                </CardDescription>

                <form onSubmit={handleLogin} className="space-y-4">
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

                <div className="mt-4">
                  <BotoesSociais desabilitado={isLoading} />
                </div>
              </TabsContent>

              <TabsContent value="signup" className="mt-0">
                <CardTitle className="text-xl mb-2">Crie sua conta</CardTitle>
                <CardDescription className="mb-6">
                  Preencha os dados abaixo para começar a usar a Lotti
                </CardDescription>

                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-nome">Nome Completo</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-nome"
                        type="text"
                        placeholder="Seu nome completo"
                        value={signupNome}
                        onChange={(e) => setSignupNome(e.target.value)}
                        className="pl-10"
                        disabled={isLoading}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="seu@email.com"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        className="pl-10"
                        disabled={isLoading}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="signup-cnpj">CNPJ</Label>
                      <div className="relative">
                        <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="signup-cnpj"
                          type="text"
                          inputMode="numeric"
                          autoComplete="organization"
                          placeholder="00.000.000/0000-00"
                          value={signupCnpj}
                          onChange={(e) => setSignupCnpj(formatarCNPJ(e.target.value))}
                          className="pl-10"
                          disabled={isLoading}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-telefone">Telefone</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="signup-telefone"
                          type="tel"
                          placeholder="(11) 99999-9999"
                          value={signupTelefone}
                          onChange={(e) => setSignupTelefone(e.target.value)}
                          className="pl-10"
                          disabled={isLoading}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Senha</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="Mínimo 6 caracteres"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        className="pl-10"
                        disabled={isLoading}
                        required
                      />
                    </div>
                  </div>

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Cadastrando...
                      </>
                    ) : (
                      <>
                        <Building2 className="mr-2 h-4 w-4" />
                        Criar Conta
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Ao continuar, você concorda com nossos Termos de Uso e Política de Privacidade
        </p>

        {/* Acesso administrativo: um link, não um segundo formulário. A
            autenticação é a mesma; o AdminRoute devolve para cá guardando o
            destino, e quem tem papel volta direto ao painel. Nenhuma credencial
            administrativa existe no frontend. */}
        <p className="mt-4 text-center">
          <Link
            to="/admin"
            className="text-xs text-muted-foreground/70 underline-offset-4 transition-colors hover:text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Acesso administrativo
          </Link>
        </p>
      </div>
      </div>

      <PainelInstitucional />
    </div>
  );
}
