import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FLAGS } from '@/lib/flags';
import { useAuth } from '@/hooks/useAuth';

/**
 * Entrar com Google / Microsoft.
 *
 * Os botões só aparecem para os provedores listados em VITE_OAUTH_PROVIDERS.
 * O código está pronto para os dois, mas habilitar aqui sem ter configurado o
 * provedor no painel do Supabase produziria um botão que só devolve
 * "Unsupported provider" — botão falso é pior que botão ausente.
 *
 * Ver infra/OAUTH.md para o passo a passo de configuração.
 */

function IconeGoogle() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" />
    </svg>
  );
}

function IconeMicrosoft() {
  return (
    <svg viewBox="0 0 23 23" className="h-4 w-4" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

export function BotoesSociais({ desabilitado }: { desabilitado?: boolean }) {
  const { entrarCom } = useAuth();
  const [indo, setIndo] = useState<string | null>(null);

  const provedores = [
    FLAGS.oauthGoogle && { id: 'google' as const, rotulo: 'Google', Icone: IconeGoogle },
    FLAGS.oauthMicrosoft && { id: 'azure' as const, rotulo: 'Microsoft', Icone: IconeMicrosoft },
  ].filter(Boolean) as { id: 'google' | 'azure'; rotulo: string; Icone: () => JSX.Element }[];

  if (provedores.length === 0) return null;

  const ir = async (id: 'google' | 'azure') => {
    setIndo(id);
    const r = await entrarCom(id);
    // Em caso de sucesso o navegador é redirecionado — nem chega a limpar.
    if (!r.ok) {
      toast.error(r.erro);
      setIndo(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-card px-2 text-muted-foreground">ou continue com</span>
        </div>
      </div>

      <div className={provedores.length > 1 ? 'grid grid-cols-2 gap-3' : ''}>
        {provedores.map(({ id, rotulo, Icone }) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={desabilitado || !!indo}
            onClick={() => ir(id)}
          >
            {indo === id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icone />}
            {rotulo}
          </Button>
        ))}
      </div>
    </div>
  );
}
