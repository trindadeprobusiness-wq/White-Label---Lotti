/**
 * Um cliente por telefone em cada conta (e uma conversa por linha do WhatsApp).
 *
 * O banco é quem garante: as RPCs de cadastro devolvem o cliente que já existe
 * em vez de criar outro, e os gatilhos recusam qualquer outro caminho com
 * `duplicate_client_phone` / `duplicate_conversation_phone`, trazendo em
 * `details` o id do registro que já tem o número. Não existe "criar mesmo
 * assim": a tela mostra o cadastro existente para o corretor abrir ou vincular.
 */

export type MotivoCandidato = 'telefone' | 'cpf' | 'email';

/** Cliente da conta que pode ser a mesma pessoa (crm_clientes_por_telefone). */
export interface CandidatoCliente {
  id: string;
  nome: string;
  motivo: MotivoCandidato;
}

export const MOTIVO_CANDIDATO: Record<MotivoCandidato, string> = {
  telefone: 'telefone',
  cpf: 'CPF/CNPJ',
  email: 'e-mail',
};

interface ErroDoBanco {
  message?: unknown;
  details?: unknown;
}

const erroDoBanco = (e: unknown): ErroDoBanco =>
  typeof e === 'object' && e !== null ? (e as ErroDoBanco) : {};

/** Código levantado pela função SQL (PostgREST devolve em `message`). */
export function codigoDoErro(e: unknown): string {
  const { message } = erroDoBanco(e);
  return typeof message === 'string' ? message : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** id do registro citado em `details` quando o erro é o código esperado. */
export function registroDoErro(e: unknown, codigo: string): string | null {
  if (codigoDoErro(e) !== codigo) return null;
  const { details } = erroDoBanco(e);
  return typeof details === 'string' && UUID.test(details.trim()) ? details.trim() : null;
}

/** Cliente que já tem o telefone, quando o banco recusou o cadastro ou a edição. */
export const clienteDoTelefone = (e: unknown) => registroDoErro(e, 'duplicate_client_phone');

export const MENSAGEM_TELEFONE_DE_OUTRO_CLIENTE =
  'Este telefone já é de outro cliente do CRM. Abra o cadastro existente em vez de criar outro.';

export const MENSAGEM_CONVERSA_EXISTENTE =
  'Já existe uma conversa com este telefone. Procure o contato na lista de conversas.';

/** Candidatos vindos do banco, descartando o que não tiver a forma esperada. */
export function candidatosValidos(valor: unknown): CandidatoCliente[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((c): c is CandidatoCliente =>
    typeof c === 'object' && c !== null
    && typeof (c as CandidatoCliente).id === 'string'
    && typeof (c as CandidatoCliente).nome === 'string'
    && ['telefone', 'cpf', 'email'].includes((c as CandidatoCliente).motivo));
}
