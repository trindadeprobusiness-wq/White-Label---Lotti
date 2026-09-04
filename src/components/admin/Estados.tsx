import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AcessoNegadoError } from '@/lib/admin/api';
import { mensagemDeErro } from '@/lib/errors';

/** Nada a mostrar porque ainda não existe dado, ou porque o filtro não achou. */
export function EstadoVazio({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="rounded-full bg-muted p-3">
          <Inbox className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="font-medium">{titulo}</p>
        {descricao && (
          <p className="max-w-md text-sm text-muted-foreground">{descricao}</p>
        )}
        {acao}
      </CardContent>
    </Card>
  );
}

/**
 * Erro de carregamento.
 *
 * Distingue permissão de falha genérica: perder o papel administrativo no meio
 * da sessão precisa dizer isso, e não "tente novamente" — repetir não resolve.
 */
export function EstadoErro({
  erro,
  aoTentarNovamente,
}: {
  erro: unknown;
  aoTentarNovamente?: () => void;
}) {
  const semPermissao = erro instanceof AcessoNegadoError;

  return (
    <Card className="border-destructive/50 bg-destructive/5">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="rounded-full bg-destructive/10 p-3">
          {semPermissao ? (
            <Lock className="h-5 w-5 text-destructive" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          )}
        </div>
        <p className="font-medium">
          {semPermissao ? 'Você não tem permissão para ver isto' : 'Não foi possível carregar'}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {semPermissao
            ? 'Seu papel administrativo pode ter sido alterado. Entre novamente ou fale com um super admin.'
            : mensagemDeErro(erro, 'Verifique sua conexão e tente novamente.')}
        </p>
        {!semPermissao && aoTentarNovamente && (
          <Button variant="outline" size="sm" onClick={aoTentarNovamente}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar novamente
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Métrica que depende de dado que ainda não existe.
 *
 * Existe para não exibir "R$ 0,00" onde a verdade é "nada foi registrado
 * ainda". Zero é uma afirmação sobre o negócio; ausência de dado não é.
 */
export function SemDadosAinda({ titulo, explicacao }: { titulo: string; explicacao: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{titulo}</p>
        <p className="mt-2 text-base font-medium text-muted-foreground">Sem dados ainda</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">{explicacao}</p>
      </CardContent>
    </Card>
  );
}
