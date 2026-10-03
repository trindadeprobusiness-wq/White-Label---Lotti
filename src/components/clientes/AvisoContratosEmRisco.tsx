import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { rotuloDoTipo, type ContratoEmRisco } from '@/hooks/crm/useContratosDosClientes';

/**
 * O que a exclusão de um cliente leva junto, dito antes do clique.
 *
 * Falha fechada: enquanto a consulta não volta, ou se ela falhar, quem usa
 * este aviso deve manter o botão de excluir travado (ver `podeExcluirCliente`).
 * Deixar excluir "sem saber" foi exatamente o que apagou contratos ativos.
 */
export function AvisoContratosEmRisco({
  consulta,
  nomeDoCliente,
}: {
  consulta: UseQueryResult<ContratoEmRisco[]>;
  nomeDoCliente?: (id: string) => string | undefined;
}) {
  if (consulta.isPending) {
    return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Verificando contratos vinculados…
    </p>;
  }

  if (consulta.isError) {
    return <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      Não foi possível verificar se há contratos vinculados. Por segurança, a exclusão fica bloqueada — recarregue a página e tente de novo.
    </p>;
  }

  const contratos = consulta.data ?? [];
  if (!contratos.length) return null;

  return <div role="alert" data-testid="contratos-em-risco" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
    <p className="flex items-start gap-2 font-semibold text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {contratos.length === 1
        ? 'Isto também apaga 1 contrato, para sempre:'
        : `Isto também apaga ${contratos.length} contratos, para sempre:`}
    </p>
    <ul className="space-y-1 pl-6">
      {contratos.map((contrato) => {
        const nome = nomeDoCliente?.(contrato.clienteId);
        return <li key={contrato.id} className="flex items-start gap-1.5 text-foreground">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <strong className="font-medium">{rotuloDoTipo(contrato.tipo)}</strong>
            {contrato.imovel && <> — {contrato.imovel}</>}
            {contrato.status && <span className="text-muted-foreground"> · {contrato.status}</span>}
            {nome && <span className="block text-xs text-muted-foreground">Cliente: {nome}</span>}
          </span>
        </li>;
      })}
    </ul>
    <p className="text-destructive">
      Junto saem as faturas e os repasses desses contratos. Não tem como desfazer pela plataforma.
      Se o contrato só terminou, encerre o contrato em vez de excluir o cliente.
    </p>
  </div>;
}

