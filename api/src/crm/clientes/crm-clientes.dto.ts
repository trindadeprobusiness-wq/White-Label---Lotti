import { IsIn, IsISO8601, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export const STATUS_FUNIL = ['QUALIFICACAO', 'VISITA_PROPOSTA', 'DOCUMENTACAO', 'FECHADO_GANHO', 'FECHADO_PERDIDO'] as const;
export const TIPOS_INTERESSE = ['COMPRA', 'LOCACAO', 'AMBOS'] as const;
export const CANAIS_CONTATO = ['WHATSAPP', 'EMAIL', 'TELEFONE', 'PRESENCIAL', 'OUTRO'] as const;
export const DIRECOES_CONTATO = ['IN', 'OUT'] as const;
export const LIMITE_LISTA = 1000;
// cpf entra no bloco B1: o BillsList grava o CPF que o corretor confirmou na leitura do contrato pela IA
// (sobrescreve, como fazia pelo Supabase). Quem só completa CPF vazio segue usando POST :id/completar-cpf.
export const COLUNAS_EDICAO_CLIENTE = ['nome', 'telefone', 'email', 'tipo_interesse', 'observacoes', 'ultimo_contato', 'cpf'] as const;

const definido = (_o: unknown, v: unknown) => v !== undefined;
/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CriarClienteDto {
  // Nome vazio passa de propósito: quem responde é a função do banco (invalid_name → 422), e o front já tem o texto para isso.
  @IsString({ message: 'Informe o nome do cliente.' }) @MaxLength(200, { message: 'O nome pode ter até 200 caracteres.' }) nome!: string;
  @IsString({ message: 'Informe o telefone.' }) @MaxLength(40, { message: 'Telefone inválido.' }) telefone!: string; // '' é aceito
  @IsOptional() @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'O e-mail pode ter até 200 caracteres.' }) email?: string | null; // '' é aceito (sem IsEmail)
  @IsOptional() @IsString({ message: 'CPF/CNPJ inválido.' }) @MaxLength(40, { message: 'CPF/CNPJ inválido.' }) cpf?: string | null;
  @ValidateIf(definido) @IsIn(TIPOS_INTERESSE, { message: 'Tipo de interesse inválido.' }) tipo_interesse?: string;
  @ValidateIf(definido) @IsIn(STATUS_FUNIL, { message: 'Etapa do funil inválida.' }) status_funil?: string;
  @IsOptional() @IsString({ message: 'Observações inválidas.' }) @MaxLength(5000, { message: 'As observações podem ter até 5000 caracteres.' }) observacoes?: string | null;
  @IsOptional() @IsISO8601({}, { message: 'Data do último contato inválida.' }) ultimo_contato?: string | null;
  @IsOptional() @IsObject({ message: 'Dados de rastreamento inválidos.' }) tracking_data?: Record<string, unknown> | null;
}

export class BuscarCandidatosDto { // query string
  @IsOptional() @IsString({ message: 'Telefone inválido.' }) @MaxLength(40, { message: 'Telefone inválido.' }) telefone?: string;
  @IsOptional() @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString({ message: 'CPF/CNPJ inválido.' }) @MaxLength(40, { message: 'CPF/CNPJ inválido.' }) cpf?: string;
}

export class AtualizarClienteDto {
  @ValidateIf(definido) @IsString({ message: 'Informe o nome do cliente.' }) @MaxLength(200, { message: 'O nome pode ter até 200 caracteres.' }) nome?: string;
  @ValidateIf(definido) @IsString({ message: 'Informe o telefone.' }) @MaxLength(40, { message: 'Telefone inválido.' }) telefone?: string;
  @IsOptional() @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'O e-mail pode ter até 200 caracteres.' }) email?: string | null;
  @ValidateIf(definido) @IsIn(TIPOS_INTERESSE, { message: 'Tipo de interesse inválido.' }) tipo_interesse?: string;
  @IsOptional() @IsString({ message: 'Observações inválidas.' }) @MaxLength(5000, { message: 'As observações podem ter até 5000 caracteres.' }) observacoes?: string | null;
  @IsOptional() @IsISO8601({}, { message: 'Data do último contato inválida.' }) ultimo_contato?: string | null;
  @IsOptional() @IsString({ message: 'CPF/CNPJ inválido.' }) @MaxLength(40, { message: 'CPF/CNPJ inválido.' }) cpf?: string | null;
}

export class MoverClienteDto {
  @IsIn(STATUS_FUNIL, { message: 'Etapa do funil inválida.' }) status_funil!: string;
}

export class DefinirImovelInteresseDto {
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) imovel_id?: string | null;
}

export class CompletarCpfDto {
  @Matches(/^(\d{11}|\d{14})$/, { message: 'CPF/CNPJ deve ter 11 ou 14 dígitos.' }) cpf!: string;
}

export class RegistrarHistoricoDto {
  @IsIn(CANAIS_CONTATO, { message: 'Canal de contato inválido.' }) tipo!: string;
  @ValidateIf(definido) @IsIn(DIRECOES_CONTATO, { message: 'Direção inválida.' }) direcao?: string;
  @IsString({ message: 'Descreva o contato.' }) @MaxLength(5000, { message: 'O texto pode ter até 5000 caracteres.' }) conteudo!: string; // '' é aceito
  @IsOptional() @IsObject({ message: 'Metadados inválidos.' }) metadata?: Record<string, unknown> | null;
}

export class ConverterLeadDto {
  @Matches(FORMATO_UUID, { message: 'Lead inválido.' }) lead_id!: string;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Etapa inválida.' }) etapa_id?: string | null;
  @IsOptional() @IsString({ message: 'Nome inválido.' }) @MaxLength(200, { message: 'O nome pode ter até 200 caracteres.' }) nome?: string;
  @IsOptional() @IsString({ message: 'Telefone inválido.' }) @MaxLength(40, { message: 'Telefone inválido.' }) telefone?: string;
  @IsOptional() @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'O e-mail pode ter até 200 caracteres.' }) email?: string | null;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
}
