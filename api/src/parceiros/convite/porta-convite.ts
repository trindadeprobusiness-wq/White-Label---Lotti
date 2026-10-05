import { Injectable } from '@nestjs/common';
import { ERROS } from '../parceiros.erros';

/**
 * A porta de envio do convite.
 *
 * Nenhuma chamada a auth.admin.inviteUserByEmail, generateLink, updateUserById ou signInWithOtp existe
 * na API: isso exigiria a service key do Supabase, que este módulo deixou de ler. Enquanto ninguém
 * escolher o provedor (pendência §7.2.1), a implementação viva responde 503 com texto claro.
 */
export const PORTA_CONVITE = Symbol('PORTA_CONVITE');

export interface DadosDoConvite {
  email: string;
  redirectTo: string;
  metadados: {
    tipo_acesso: 'parceiro';
    parceiro_id: string;
    nome_parceiro: string;
    comissao: string;
    regra_renovacao: string;
    link_parceiro: string;
  };
  /** Já existe conta para este e-mail: o provedor manda acesso, não convite novo. */
  contaExistente: boolean;
}

export interface ResultadoDoConvite {
  /** user_id da conta no provedor de identidade, quando ele cria ou localiza uma. */
  userId: string | null;
  contaExistente: boolean;
}

export interface PortaDeConvite {
  enviarConvite(dados: DadosDoConvite): Promise<ResultadoDoConvite>;
}

/** Implementação viva até alguém escolher o provedor (§7.2.1). */
@Injectable()
export class ConviteSemProvedor implements PortaDeConvite {
  async enviarConvite(): Promise<ResultadoDoConvite> {
    throw ERROS.provedorDeEmailNaoConfigurado();
  }
}
