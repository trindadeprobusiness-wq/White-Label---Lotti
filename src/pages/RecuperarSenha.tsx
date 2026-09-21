import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { useAuth } from '@/hooks/useAuth';
import { emailRecuperacaoSchema } from '@/lib/auth/validacao';
import { z } from 'zod';

/**
 * Recuperação de senha — não existia no projeto. Quem esquecia a senha ficava
 * permanentemente trancado fora, sem caminho de autoatendimento.
 */
export default function RecuperarSenha() {
  const { pedirRecuperacao } = useAuth();
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    let emailValidado: string;
    try {
      emailValidado = emailRecuperacaoSchema.parse(email);
    } catch (falha) {
      setErro(falha instanceof z.ZodError ? falha.errors[0].message : 'Informe um e-mail válido.');
      return;
    }

    setEmail(emailValidado);
    setEnviando(true);
    const r = await pedirRecuperacao(emailValidado);
    setEnviando(false);
    // Confirmação idêntica com ou sem conta: dizer "e-mail não encontrado"
    // entregaria a estranhos quais endereços têm conta aqui.
    if (r.ok) setEnviado(true);
    else setErro(r.erro ?? null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <LottiLogo variant="full" className="h-9" />
        </div>

        <Card>
          <CardContent className="pt-6">
            {enviado ? (
              <div className="text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>
                <h1 className="text-lg font-semibold">Verifique seu e-mail</h1>
                <p className="text-sm text-muted-foreground">
                  Se existir uma conta para <strong className="text-foreground">{email}</strong>,
                  enviamos um link para criar uma nova senha. Ele vale por tempo limitado.
                </p>
                <p className="text-xs text-muted-foreground">
                  Não chegou? Confira a caixa de spam antes de pedir de novo.
                </p>
              </div>
            ) : (
              <form onSubmit={enviar} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <h1 className="text-xl font-semibold">Esqueceu a senha?</h1>
                  <p className="text-sm text-muted-foreground">
                    Informe seu e-mail e enviamos um link para você criar uma nova.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email-recuperacao">E-mail</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email-recuperacao"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="pl-9"
                      aria-invalid={!!erro}
                      aria-describedby={erro ? 'erro-recuperacao' : undefined}
                    />
                  </div>
                  {erro && (
                    <p id="erro-recuperacao" role="alert" className="text-sm text-destructive">{erro}</p>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={enviando || !email.trim()}>
                  {enviando
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</>
                    : 'Enviar link de recuperação'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Link
          to="/auth"
          className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para o login
        </Link>
      </div>
    </div>
  );
}
