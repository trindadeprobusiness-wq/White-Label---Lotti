import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { mensagemDeAuth } from '@/lib/auth/mensagens';
import { isolarTrocaDeSessao } from '@/lib/auth/isolamentoSessao';
import {
  deveRegistrarAtividade,
  marcarAtividadeRegistrada,
  obterVisitanteId,
  temAtribuicaoPendente,
  limparAtribuicaoPendente,
} from '@/lib/admin/atribuicao';

interface SignUpMetadata {
  nome: string;
  cnpj: string;
  telefone: string;
}

type Resultado = { ok: boolean; erro?: string };

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAuthenticated: boolean;
  signUp: (email: string, password: string, metadata: SignUpMetadata) => Promise<Resultado & { precisaConfirmarEmail?: boolean }>;
  signIn: (email: string, password: string) => Promise<Resultado>;
  signOut: () => Promise<void>;
  entrarCom: (provedor: 'google' | 'azure') => Promise<Resultado>;
  pedirRecuperacao: (email: string) => Promise<Resultado>;
  definirNovaSenha: (senha: string) => Promise<Resultado>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Registra que o usuário esteve presente.
 *
 * É o que torna "usuário ativo" calculável no back office — antes disso não
 * existia nenhum dado de atividade fora de auth.users.last_sign_in_at, que não
 * é consultável. O throttle de 30 min evita uma linha por navegação.
 *
 * Falha em silêncio de propósito: é telemetria, e não pode atrapalhar o login.
 */
async function registrarAtividadeSeNecessario(): Promise<void> {
  try {
    if (!deveRegistrarAtividade()) return;
    await supabase.rpc('registrar_atividade' as never, {
      p_tipo: 'login',
      p_rota: window.location.pathname,
    } as never);
    marcarAtividadeRegistrada();
  } catch {
    /* telemetria nunca quebra a sessão */
  }
}

/**
 * Fecha o vínculo com o parceiro que trouxe este usuário, se houver.
 *
 * Só o visitante_id — um UUID opaco — sai daqui; quem é o parceiro é decidido
 * no servidor a partir do clique que ele mesmo registrou. Idempotente pelo
 * UNIQUE(user_id) no banco, então rodar a cada login é inofensivo.
 */
async function reivindicarAtribuicaoDeParceiro(): Promise<void> {
  try {
    if (!temAtribuicaoPendente()) return;

    const { data } = await supabase.functions.invoke('parceiro-atribuir', {
      body: { visitante_id: obterVisitanteId() },
    });

    const resposta = data as { ok?: boolean; ja_atribuido?: boolean } | null;

    // Limpa quando resolveu — para o bem (vinculou) ou para o mal (expirou,
    // parceiro inativo, autoindicação). Insistir a cada login não mudaria o
    // resultado e só geraria chamada inútil.
    if (resposta?.ok || resposta?.ja_atribuido) {
      limparAtribuicaoPendente();
    }
  } catch {
    /* tenta de novo no próximo login */
  }
}

/**
 * Estado de autenticação — UM só para o app inteiro.
 *
 * Antes isto era um hook comum, e cada consumidor (ProtectedRoute, Auth,
 * AppSidebar) criava a própria cópia: três `onAuthStateChange` e três
 * `getSession()` em paralelo. Efeito visível: a cada troca de rota que
 * remontava o ProtectedRoute, `loading` voltava a true e a tela inteira piscava
 * o spinner até a sessão resolver de novo.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const ultimoUsuarioId = useRef<string | null | undefined>(undefined);

  const aplicarSessao = useCallback((sessao: Session | null) => {
    const usuarioAtual = sessao?.user.id ?? null;
    isolarTrocaDeSessao(ultimoUsuarioId.current, usuarioAtual, queryClient);
    ultimoUsuarioId.current = usuarioAtual;
    setSession(sessao);
    setUser(sessao?.user ?? null);
  }, [queryClient]);

  useEffect(() => {
    // O listener vem antes do getSession para não perder o evento que chega
    // entre uma coisa e outra.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, sessao) => {
      aplicarSessao(sessao);
      setLoading(false);

      // Efeitos pós-login. Rodam soltos e nunca são aguardados: o callback do
      // onAuthStateChange não pode bloquear, e nenhum dos dois pode atrasar ou
      // impedir a entrada do usuário.
      if (evento === 'SIGNED_IN' && sessao) {
        void registrarAtividadeSeNecessario();
        void reivindicarAtribuicaoDeParceiro();
      }
    });

    supabase.auth.getSession()
      .then(({ data: { session: sessao }, error }) => {
        if (error) console.error('Erro ao obter sessão:', error);
        aplicarSessao(sessao);
      })
      .catch((e) => console.error('Erro inesperado ao obter sessão:', e))
      .finally(() => setLoading(false));

    return () => subscription.unsubscribe();
  }, [aplicarSessao]);

  const signUp = useCallback(async (email: string, password: string, metadata: SignUpMetadata) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          nome: metadata.nome,
          cnpj: metadata.cnpj,
          // Mantém compatibilidade até a migration do cadastro por CNPJ ser
          // aplicada: a coluna legada continua NOT NULL no banco.
          creci: 'PENDENTE',
          telefone: metadata.telefone,
        },
      },
    });

    if (error) {
      console.error('Erro no cadastro:', error);
      return { ok: false, erro: mensagemDeAuth(error) };
    }

    // Com confirmação de e-mail ligada no projeto, o signUp devolve sucesso com
    // sessão nula. Dizer "já pode acessar" nesse caso é mentira: o login
    // seguinte falha com "Email not confirmed".
    return { ok: true, precisaConfirmarEmail: !data.session };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('Erro no login:', error);
      return { ok: false, erro: mensagemDeAuth(error) };
    }
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Erro no logout:', error);
      toast.error(mensagemDeAuth(error, 'Não foi possível sair. Tente novamente.'));
      return;
    }
    toast.success('Você saiu da sua conta.');
  }, []);

  /**
   * Login social. O Supabase redireciona o navegador para o provedor e volta em
   * `redirectTo`; o `onAuthStateChange` acima captura a sessão na volta, então
   * não há o que fazer aqui além de disparar.
   *
   * O trigger `handle_new_user` cria o corretor para QUALQUER novo usuário do
   * auth, inclusive social — mas o Google não manda CNPJ nem telefone, então
   * esses campos continuam pendentes para um onboarding futuro.
   */
  const entrarCom = useCallback(async (provedor: 'google' | 'azure') => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provedor,
      options: {
        redirectTo: `${window.location.origin}/auth`,
        // Microsoft: sem 'email' explícito o token volta sem endereço e o
        // corretor nasce sem e-mail.
        scopes: provedor === 'azure' ? 'email openid profile' : undefined,
      },
    });
    if (error) {
      console.error(`Erro no login com ${provedor}:`, error);
      return { ok: false, erro: mensagemDeAuth(error) };
    }
    return { ok: true };
  }, []);

  /**
   * Envia o e-mail de recuperação. Não existia caminho nenhum de recuperação no
   * projeto: quem esquecia a senha ficava trancado para sempre.
   */
  const pedirRecuperacao = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/nova-senha`,
    });
    if (error) {
      console.error('Erro ao pedir recuperação:', error);
      return { ok: false, erro: mensagemDeAuth(error) };
    }
    return { ok: true };
  }, []);

  /** Grava a nova senha. Só funciona com a sessão de recuperação ativa. */
  const definirNovaSenha = useCallback(async (senha: string) => {
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      console.error('Erro ao definir nova senha:', error);
      return { ok: false, erro: mensagemDeAuth(error) };
    }
    return { ok: true };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user, session, loading, isAuthenticated: !!session,
        signUp, signIn, signOut, entrarCom, pedirRecuperacao, definirNovaSenha,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  // Falhar alto: sem o provider, a tela silenciosamente acharia que ninguém
  // está logado e mandaria todo mundo para o login.
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}
