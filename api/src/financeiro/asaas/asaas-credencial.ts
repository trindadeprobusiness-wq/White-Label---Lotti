import { Prisma } from '@prisma/client';
import type { ServicoDb } from '../servico-db';
import { chaveCifra } from './asaas.config';
import { decifrar } from './asaas-crypto';
import { AmbienteAsaas, AsaasNaoConectado } from './asaas-http';

export interface CredencialAsaas {
  apiKey: string;
  ambiente: AmbienteAsaas;
  conexaoId: string;
}

interface LinhaConexao {
  id: string;
  ambiente: string | null;
  status: string | null;
  herdada_do_ambiente: boolean | null;
  api_key_ciphertext: string | null;
}

/**
 * Porte de resolverCredencial SEM chave global (D5): só a chave cifrada da própria conexão.
 * Nenhuma variável com chave do Asaas é lida (nem ASAAS_API_KEY, nem a válvula ASAAS_PERMITIR_CHAVE_GLOBAL).
 * A chave da cifra é conferida antes de abrir o banco: sem ela, 503.
 */
export async function resolverCredencial(servico: ServicoDb, corretorId: string): Promise<CredencialAsaas> {
  const chave = chaveCifra();
  if (!corretorId) throw new AsaasNaoConectado('Não foi possível identificar o corretor da sessão.');
  const linhas = await servico.run((tx) => tx.$queryRaw<LinhaConexao[]>(Prisma.sql`
    select c.id::text as id, c.ambiente, c.status, c.herdada_do_ambiente, s.api_key_ciphertext
      from public.asaas_conexoes c left join public.asaas_conexao_segredos s on s.conexao_id = c.id
     where c.corretor_id = ${corretorId}::uuid`));
  const conexao = linhas[0];
  if (!conexao) throw new AsaasNaoConectado();
  if (conexao.status === 'invalida') {
    throw new AsaasNaoConectado('A chave da Asaas foi recusada. Conecte a conta novamente com uma chave válida.');
  }
  const ambiente: AmbienteAsaas = conexao.ambiente === 'sandbox' ? 'sandbox' : 'producao';
  if (conexao.api_key_ciphertext) {
    let apiKey = '';
    try {
      apiKey = decifrar(conexao.api_key_ciphertext, chave);
    } catch {
      apiKey = '';
    }
    if (!apiKey) throw new AsaasNaoConectado('A chave da Asaas guardada está ilegível. Conecte a conta novamente.');
    return { apiKey, ambiente, conexaoId: conexao.id };
  }
  if (conexao.herdada_do_ambiente) {
    // D5: a chave global não existe mais na API; a conexão herdada precisa reconectar.
    throw new AsaasNaoConectado('A conta Asaas herdada não está mais configurada no servidor. Conecte a chave da sua conta.');
  }
  throw new AsaasNaoConectado();
}
