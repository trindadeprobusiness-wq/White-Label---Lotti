import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface DialogoConfirmacaoProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao: string;
  rotuloConfirmar?: string;
  destrutivo?: boolean;
  /**
   * Exige justificativa antes de confirmar. É o que faz a linha de auditoria
   * valer alguma coisa: sem motivo, o histórico registra que algo aconteceu mas
   * não por quê.
   */
  exigirMotivo?: boolean;
  minimoMotivo?: number;
  aoConfirmar: (motivo: string) => void | Promise<void>;
}

export function DialogoConfirmacao({
  aberto,
  aoFechar,
  titulo,
  descricao,
  rotuloConfirmar = 'Confirmar',
  destrutivo = false,
  exigirMotivo = false,
  minimoMotivo = 10,
  aoConfirmar,
}: DialogoConfirmacaoProps) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Reabrir com o motivo anterior preenchido levaria a auditar uma ação com a
  // justificativa de outra.
  useEffect(() => {
    if (aberto) {
      setMotivo('');
      setEnviando(false);
    }
  }, [aberto]);

  const motivoOk = !exigirMotivo || motivo.trim().length >= minimoMotivo;
  const faltam = minimoMotivo - motivo.trim().length;

  const confirmar = async () => {
    if (!motivoOk || enviando) return;
    setEnviando(true);
    try {
      await aoConfirmar(motivo.trim());
      aoFechar();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <AlertDialog open={aberto} onOpenChange={(estado) => !estado && aoFechar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descricao}</AlertDialogDescription>
        </AlertDialogHeader>

        {exigirMotivo && (
          <div className="space-y-2">
            <Label htmlFor="motivo-admin">
              Justificativa <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="motivo-admin"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Descreva o motivo desta ação. Fica registrado na auditoria."
              rows={3}
              autoFocus
            />
            <p
              className={cn(
                'text-xs',
                motivoOk ? 'text-muted-foreground' : 'text-destructive',
              )}
            >
              {motivoOk
                ? 'Registrado na auditoria com seu usuário e a data.'
                : `Escreva ao menos mais ${faltam} caractere${faltam > 1 ? 's' : ''}.`}
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // O AlertDialogAction fecha sozinho ao clicar; segurar aqui deixa
              // o diálogo aberto se a chamada falhar, preservando o motivo.
              e.preventDefault();
              void confirmar();
            }}
            disabled={!motivoOk || enviando}
            className={cn(destrutivo && 'bg-destructive hover:bg-destructive/90')}
          >
            {enviando ? 'Processando...' : rotuloConfirmar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
