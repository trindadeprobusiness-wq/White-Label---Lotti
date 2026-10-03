import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Contratos que somem junto quando um cliente é apagado.
 *
 * `contratos.cliente_id` é ON DELETE CASCADE, e o contrato leva junto as
 * faturas e os repasses (também em cascata). Apagar um cliente não avisava
 * nada disso: em 2026-10-02, três proprietários cadastrados como clientes —
 * com telefone de preenchimento, parecendo lead de teste — foram excluídos em
 * lote e levaram contratos de locação ativos, com o histórico financeiro.
 *
 * A consulta roda antes da confirmação, para a tela poder dizer exatamente o
 * que vai junto.
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
      const { data, error } = await supabase
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
 * Só libera a exclusão depois de saber, com certeza, o que vai junto.
 * Falha fechada: carregando ou com erro, não libera.
 */
export const podeExcluirCliente = (consulta: UseQueryResult<ContratoEmRisco[]>) => consulta.isSuccess;

export const temContrato = (consulta: UseQueryResult<ContratoEmRisco[]>) => (consulta.data?.length ?? 0) > 0;
