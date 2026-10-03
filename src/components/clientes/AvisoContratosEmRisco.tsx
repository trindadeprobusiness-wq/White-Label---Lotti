import { Link } from 'react-router-dom';
import { FileText, Loader2, Lock } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { rotuloDoTipo, type ContratoEmRisco } from '@/hooks/crm/useContratosDosClientes';

/**
 * Quem não pode ser excluído porque tem contrato — e o que fazer com isso.
 *
 * Desde a migration 20261003090000 o banco recusa apagar cliente com contrato
 * (ON DELETE RESTRICT). Antes apagava em cascata, contrato, faturas e
 * repasses junto — foi assim que contratos ativos sumiram em 2026-10-02.
 *
 * O banco já impede; esta tela existe para o corretor não descobrir isso por
 * um erro depois do clique. Ela diz QUEM está bloqueado, com qual contrato, e
 * oferece a saída ali mesmo: desmarcar, ou ir até a linha na lista.
 *
 * Falha fechada: enquanto a consulta não volta, ou se falhar, quem usa este
 * componente mantém o botão de excluir travado (`podeExcluirCliente`).
 */

const ROTA_DO_CONTRATO = (tipo: string) => (tipo.startsWith('LOCACAO') ? '/alugueis' : '/juridico');

type Grupo = { clienteId: string; nome: string; contratos: ContratoEmRisco[] };

function agrupar(contratos: ContratoEmRisco[], nomeDoCliente?: (id: string) => string | undefined): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const contrato of contratos) {
    const grupo = grupos.get(contrato.clienteId)
      ?? { clienteId: contrato.clienteId, nome: nomeDoCliente?.(contrato.clienteId) ?? 'Cliente', contratos: [] };
    grupo.contratos.push(contrato);
    grupos.set(contrato.clienteId, grupo);
  }
  return [...grupos.values()];
}

export function AvisoContratosEmRisco({
  consulta,
  nomeDoCliente,
  onDesmarcar,
  onMostrarNaLista,
}: {
  consulta: UseQueryResult<ContratoEmRisco[]>;
  nomeDoCliente?: (id: string) => string | undefined;
  /** Exclusão em lote: tira o cliente da seleção sem fechar a caixa. */
  onDesmarcar?: (clienteIds: string[]) => void;
  /** Exclusão em lote: fecha a caixa e leva até a linha do cliente na lista. */
  onMostrarNaLista?: (clienteId: string) => void;
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

  const grupos = agrupar(consulta.data ?? [], nomeDoCliente);
  if (!grupos.length) return null;

  const varios = grupos.length > 1;
  const lote = !!onDesmarcar;

  return <div role="alert" data-testid="contratos-em-risco" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
    <p className="flex items-start gap-2 font-semibold">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {!lote
        ? 'Este cliente tem contrato e não pode ser excluído.'
        : varios
          ? `${grupos.length} clientes selecionados têm contrato e não podem ser excluídos.`
          : `${grupos[0].nome} tem contrato e não pode ser excluído.`}
    </p>

    <ul className="space-y-2">
      {grupos.map((grupo) => <li key={grupo.clienteId} data-testid="cliente-com-contrato" className="rounded-md border border-amber-200 bg-background/70 p-2.5 dark:border-amber-800">
        {lote && <p className="font-medium text-foreground">{grupo.nome}</p>}
        <ul className="mt-0.5 space-y-0.5">
          {grupo.contratos.map((contrato) => <li key={contrato.id} className="flex items-start gap-1.5 text-foreground">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              {rotuloDoTipo(contrato.tipo)}
              {contrato.imovel && <> — {contrato.imovel}</>}
              {contrato.status && <span className="font-semibold"> · {contrato.status}</span>}
            </span>
          </li>)}
        </ul>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {onDesmarcar && <button type="button" onClick={() => onDesmarcar([grupo.clienteId])} className="font-semibold underline underline-offset-2">Desmarcar</button>}
          {onMostrarNaLista && <button type="button" onClick={() => onMostrarNaLista(grupo.clienteId)} className="font-semibold underline underline-offset-2">Mostrar na lista</button>}
          <Link to={ROTA_DO_CONTRATO(grupo.contratos[0].tipo)} className="font-semibold underline underline-offset-2">Ver contrato</Link>
        </div>
      </li>)}
    </ul>

    {onDesmarcar && varios && <button type="button" onClick={() => onDesmarcar(grupos.map((g) => g.clienteId))} className="text-xs font-semibold underline underline-offset-2">
      Desmarcar todos com contrato
    </button>}

    <p className="text-xs">
      Contrato é registro jurídico e financeiro: só sai de propósito, pela tela de contratos. Se ele terminou, encerre o contrato — o cliente continua no histórico.
    </p>
  </div>;
}
