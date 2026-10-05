import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { listarContratosDosClientesApi } from '@/lib/api/contratos';

/**
 * Contratos dos clientes que alguém quer excluir.
 *
 * Até 2026-10-02, `contratos.cliente_id` era ON DELETE CASCADE: apagar o
 * cliente apagava o contrato, e o contrato levava faturas e repasses. Naquele
 * dia, três proprietários cadastrados como clientes — com telefone de
 * preenchimento, parecendo lead de teste — foram excluídos em lote e levaram
 * contratos de locação ativos. Desde a migration 20261003090000 a chave é
 * RESTRICT e o banco recusa.
 *
 * A consulta roda antes da confirmação, para a tela dizer quem está bloqueado
 * antes do clique, em vez de o corretor descobrir por um erro depois.
 */

export type ContratoEmRisco = {
  id: string;
  clienteId: string;
  tipo: string;
  status: string;
  imovel: string | null;
};

type Linha = {
  id: string;
  cliente_id: string;
  tipo: string | null;
  status: string | null;
  imoveis: { titulo: string | null } | { titulo: string | null }[] | null;
};

const TIPO: Record<string, string> = {
  LOCACAO_RESIDENCIAL: 'Locação residencial',
  LOCACAO_COMERCIAL: 'Locação comercial',
  EXCLUSIVIDADE_VENDA: 'Exclusividade de venda',
  INTERMEDIACAO: 'Intermediação',
};

export const rotuloDoTipo = (tipo: string) => TIPO[tipo] ?? tipo.replace(/_/g, ' ').toLocaleLowerCase('pt-BR');

export function useContratosDosClientes(ids: string[], habilitado: boolean) {
  const chave = [...ids].sort();
  return useQuery({
    queryKey: ['contratos-dos-clientes', chave],
    enabled: habilitado && chave.length > 0,
    // Sempre a leitura mais nova: um contrato criado há segundos tem de aparecer.
    staleTime: 0,
    queryFn: async (): Promise<ContratoEmRisco[]> => {
      // Fase 4 (módulo contratos): com a API ligada, o erro sobe para o React Query.
      const { data, error } = apiDisponivel()
        ? { data: await listarContratosDosClientesApi(chave), error: null }
        : await supabase
          .from('contratos')
          .select('id, cliente_id, tipo, status, imoveis(titulo)')
          .in('cliente_id', chave);
      if (error) throw error;
      return ((data ?? []) as unknown as Linha[]).map((linha) => {
        const imovel = Array.isArray(linha.imoveis) ? linha.imoveis[0] : linha.imoveis;
        return {
          id: linha.id,
          clienteId: linha.cliente_id,
          tipo: linha.tipo ?? 'CONTRATO',
          status: linha.status ?? '',
          imovel: imovel?.titulo ?? null,
        };
      });
    },
  });
}

/**
 * Só libera a exclusão depois de saber, com certeza, que ninguém ali tem
 * contrato. Falha fechada: carregando ou com erro, não libera. E com contrato
 * também não: desde 20261003090000 o banco recusaria de qualquer jeito.
 */
export const podeExcluirCliente = (consulta: UseQueryResult<ContratoEmRisco[]>) =>
  consulta.isSuccess && (consulta.data?.length ?? 0) === 0;

export const temContrato = (consulta: UseQueryResult<ContratoEmRisco[]>) => (consulta.data?.length ?? 0) > 0;
