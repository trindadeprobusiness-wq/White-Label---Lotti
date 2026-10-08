import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { estaRecarregando, recarregarParaVersaoNova, recarregouHaPouco } from '@/lib/recarregar-versao';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Captura erros de render (ex.: violação das Regras de Hooks) e mostra uma tela
 * de recuperação em vez de deixar o app inteiro virar TELA PRETA.
 *
 * Sem isto, qualquer exceção durante o render desmonta toda a árvore React e o
 * usuário vê apenas uma tela preta, sem pista do que houve.
 */
/** Tela carregada sob demanda que sumiu num deploy novo (aba aberta com a versão antiga). */
export function ehErroDeVersaoNova(error: Error | null): boolean {
  const texto = `${error?.name ?? ''} ${error?.message ?? ''}`;
  return /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \d+ failed/i.test(texto);
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Reload já pedido (main.tsx): o erro é efeito colateral da versão antiga, nada a registrar.
    if (estaRecarregando()) return;
    // Mesmo guard do main.tsx: recarrega uma vez para pegar a versão nova, sem tela de erro.
    if (ehErroDeVersaoNova(error) && recarregarParaVersaoNova()) return;
    // Fica no console para diagnóstico (e futuramente pode ir para um monitor).
    console.error('ErrorBoundary capturou um erro de render:', error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    // Versão nova: o componentDidCatch recarrega logo depois deste render. Se já tinha recarregado há
    // menos de 10s, não recarrega de novo (evita loop) e cai na tela de erro, que tem o botão.
    if (this.state.hasError && (estaRecarregando() || (ehErroDeVersaoNova(this.state.error) && !recarregouHaPouco()))) {
      return (
        <div className="flex min-h-screen w-full items-center justify-center bg-background text-sm text-muted-foreground">
          Atualizando…
        </div>
      );
    }
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <div className="rounded-full bg-destructive/10 p-3 text-destructive">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">
              Algo deu errado nesta tela
            </h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Um erro inesperado interrompeu o carregamento. Suas informações estão salvas —
              você pode tentar novamente ou voltar ao início.
            </p>
          </div>

          {this.state.error?.message && (
            <pre className="max-w-md overflow-x-auto rounded-md border bg-muted/40 p-2 text-left text-[11px] text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}

          <div className="flex gap-2">
            <Button onClick={this.handleReset} variant="outline">
              <RotateCcw className="mr-2 h-4 w-4" /> Tentar novamente
            </Button>
            <Button onClick={() => { window.location.href = '/'; }}>
              Voltar ao início
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
