import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { conectarAsaasApi, desconectarAsaasApi, statusConexaoAsaasApi } from '@/lib/api/financeiro';

const client = supabase as unknown as SupabaseClient;

export interface ConexaoAsaas {
  id: string;
  ambiente: 'sandbox' | 'producao';
  status: 'nao_conectada' | 'conectada' | 'invalida' | 'sem_permissao';
  conta_nome: string | null;
  conta_email: string | null;
  chave_final: string | null;
  escopos_faltando: string[];
  validada_em: string | null;
  webhook_configurado_em: string | null;
  herdada_do_ambiente: boolean;
  rotacao_pendente: boolean;
}

interface EstadoConexaoAsaas {
  disponivel: boolean;
  conexao: ConexaoAsaas | null;
}

interface RespostaConexao {
  ok: boolean;
  balance?: number | null;
  aviso?: string | null;
  conexao?: Partial<ConexaoAsaas>;
}

export const asaasConnectionKeys = {
  todos: ['asaas-connection'] as const,
  status: () => [...asaasConnectionKeys.todos, 'status'] as const,
};

function recursoAindaNaoAplicado(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? '')
    || /asaas_conexoes|schema cache/i.test(error.message ?? '');
}

async function buscarStatus(): Promise<EstadoConexaoAsaas> {
  if (apiDisponivel()) {
    const estado = await statusConexaoAsaasApi();
    return { disponivel: estado.disponivel, conexao: (estado.conexao as unknown as ConexaoAsaas | null) ?? null };
  }
  const { data, error } = await client
    .from('asaas_conexoes')
    .select('id, ambiente, status, conta_nome, conta_email, chave_final, escopos_faltando, validada_em, webhook_configurado_em, herdada_do_ambiente, rotacao_pendente')
    .maybeSingle();
  if (error) {
    if (recursoAindaNaoAplicado(error)) return { disponivel: false, conexao: null };
    throw error;
  }
  return { disponivel: true, conexao: (data as ConexaoAsaas | null) ?? null };
}

async function mensagemErroFuncao(error: unknown): Promise<string> {
  const erro = error as { message?: string; context?: { json?: () => Promise<unknown> } };
  try {
    const body = await erro.context?.json?.() as { error?: string } | undefined;
    if (body?.error) return body.error;
  } catch {
    // A resposta pode não ser JSON em falhas de rede/gateway.
  }
  return erro.message || 'Não foi possível concluir a conexão com a Asaas.';
}

async function invocarApi(body: Record<string, unknown>): Promise<RespostaConexao> {
  try {
    if (body.action === 'desconectar') return (await desconectarAsaasApi()) as RespostaConexao;
    return (await conectarAsaasApi(String(body.api_key ?? ''), body.ambiente as 'sandbox' | 'producao')) as RespostaConexao;
  } catch (e) {
    throw new Error((e as Error).message || 'Não foi possível concluir a conexão com a Asaas.');
  }
}

async function invocar(body: Record<string, unknown>): Promise<RespostaConexao> {
  if (apiDisponivel()) return invocarApi(body);
  const { data, error } = await supabase.functions.invoke('asaas-conexao', { body });
  if (error) throw new Error(await mensagemErroFuncao(error));
  if (data?.error) throw new Error(data.error);
  return data as RespostaConexao;
}

export function useAsaasConnection() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: asaasConnectionKeys.status(),
    queryFn: buscarStatus,
    staleTime: 30_000,
    retry: false,
  });

  const atualizar = async () => {
    await queryClient.invalidateQueries({ queryKey: asaasConnectionKeys.todos });
  };

  const conectar = useMutation({
    mutationFn: ({ apiKey, ambiente }: { apiKey: string; ambiente: 'sandbox' | 'producao' }) =>
      invocar({ action: 'conectar', api_key: apiKey, ambiente }),
    onSuccess: atualizar,
  });

  const desconectar = useMutation({
    mutationFn: () => invocar({ action: 'desconectar' }),
    onSuccess: atualizar,
  });

  return {
    conexao: status.data?.conexao ?? null,
    disponivel: status.data?.disponivel ?? true,
    carregando: status.isLoading,
    erro: status.error,
    recarregar: status.refetch,
    conectar,
    desconectar,
  };
}
