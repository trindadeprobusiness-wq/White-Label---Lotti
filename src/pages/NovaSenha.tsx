import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { useAuth } from '@/hooks/useAuth';

const MINIMO = 8;

/**
 * Destino do link enviado por e-mail. O Supabase troca o token do link por uma
 * sessão de recuperação automaticamente, então aqui basta ter sessão — se não
 * tiver, o link expirou, já foi usado, ou a pessoa abriu a rota na mão.
 */
export default function NovaSenha() {
  const { definirNovaSenha, session, loading } = useAuth();
  const navigate = useNavigate();
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Sem sessão de recuperação não há o que fazer aqui.
  const linkInvalido = !loading && !session;

  useEffect(() => {
    if (linkInvalido) {
      toast.error('Este link expirou ou já foi usado. Peça um novo.');
    }
  }, [linkInvalido]);

  const curta = senha.length > 0 && senha.length < MINIMO;
  const naoConfere = confirma.length > 0 && senha !== confirma;
  const podeSalvar = !!session && !loading && senha.length >= MINIMO && senha === confirma && !salvando;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    const r = await definirNovaSenha(senha);
    setSalvando(false);

    if (!r.ok) { setErro(r.erro ?? null); return; }
    toast.success('Senha alterada! Você já está conectado.');
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <LottiLogo variant="full" className="h-9" />
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center" role="status" aria-label="Validando link">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : linkInvalido ? (
              <div className="text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-amber-500" />
                </div>
                <h1 className="text-lg font-semibold">Link expirado</h1>
                <p className="text-sm text-muted-foreground">
                  Links de recuperação valem por tempo limitado e só podem ser usados uma vez.
                </p>
                <Button asChild className="w-full mt-2">
                  <Link to="/recuperar-senha">Pedir um novo link</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={salvar} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <h1 className="text-xl font-semibold">Criar nova senha</h1>
                  <p className="text-sm text-muted-foreground">
                    Use pelo menos {MINIMO} caracteres.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nova-senha">Nova senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="nova-senha"
                      type={mostrar ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="pl-9 pr-9"
                      aria-invalid={curta}
                      aria-describedby={curta ? 'erro-curta' : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setMostrar((v) => !v)}
                      aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {curta && (
                    <p id="erro-curta" className="text-sm text-destructive">
                      Faltam {MINIMO - senha.length} caractere(s).
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirma-senha">Repita a senha</Label>
                  <Input
                    id="confirma-senha"
                    type={mostrar ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirma}
                    onChange={(e) => setConfirma(e.target.value)}
                    aria-invalid={naoConfere}
                    aria-describedby={naoConfere ? 'erro-confere' : undefined}
                  />
                  {naoConfere && (
                    <p id="erro-confere" className="text-sm text-destructive">
                      As senhas não são iguais.
                    </p>
                  )}
                </div>

                {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}

                <Button type="submit" className="w-full" disabled={!podeSalvar}>
                  {salvando
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
                    : 'Salvar nova senha'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
