import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { candidatosValidos, clienteDoTelefone } from './duplicidade';

// crm_* ainda não estão no types.ts gerado.
const db = supabase as unknown as SupabaseClient;

export interface DadosClienteNovo {
  nome: string;
  telefone: string;
  email?: string | null;
  cpf?: string | null;
  tipo_interesse?: string;
  observacoes?: string;
}

/**
 * Cliente para um fluxo que precisa de um cadastro para continuar (importar
 * contrato, por exemplo). Cria pela RPC do CRM; quando o telefone já é de um
 * cliente da conta, devolve esse cliente (`criado: false`) — o fluxo segue
 * vinculado a ele em vez de duplicar a pessoa. Só quem foi criado aqui pode
 * ser desfeito pelo fluxo se algo falhar depois.
 */
export async function cadastrarOuReaproveitarCliente(
  dados: DadosClienteNovo,
): Promise<{ id: string; criado: boolean; nome: string }> {
  const { data, error } = await db.rpc('crm_criar_cliente', { p_dados: dados });
  if (error) {
    const existente = clienteDoTelefone(error);
    if (existente) return { id: existente, criado: false, nome: '' };
    throw error;
  }
  const resultado = data as { status: string; cliente_id?: string; candidatos?: unknown };
  if (resultado.status === 'duplicate') {
    const [dono] = candidatosValidos(resultado.candidatos);
    if (!dono) throw new Error('Este telefone já é de outro cliente do CRM.');
    return { id: dono.id, criado: false, nome: dono.nome };
  }
  if (!resultado.cliente_id) throw new Error('Não foi possível cadastrar o cliente.');
  return { id: resultado.cliente_id, criado: true, nome: dados.nome };
}

/**
 * Guarda o CPF lido no contrato num cliente que ainda não tem. Nunca troca um
 * CPF já cadastrado: o corretor revisa esse caso na ficha do cliente.
 */
export async function completarCpfDoCliente(clienteId: string, cpf: string | null | undefined) {
  const digitos = (cpf ?? '').replace(/\D/g, '');
  if (digitos.length !== 11 && digitos.length !== 14) return;
  const { error } = await db.from('clientes').update({ cpf: digitos }).eq('id', clienteId).is('cpf', null);
  if (error) console.error('Não foi possível guardar o CPF do cliente:', error);
}
