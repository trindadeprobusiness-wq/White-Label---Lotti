import { IsBoolean, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { definido, FORMATO_UUID, naoNulo } from './contratos.dto';

export const COLUNAS_DOC_CRIACAO = ['nome', 'tipo', 'arquivo_path', 'arquivo_url', 'cliente_id', 'imovel_id', 'data_validade', 'observacoes'] as const;
export const COLUNAS_DOC_ALTERACAO = ['nome', 'tipo', 'cliente_id', 'imovel_id', 'data_validade', 'observacoes', 'validado'] as const;

const NOME = { message: 'Informe o nome do documento.' };
const TIPO = { message: 'Informe o tipo do documento.' };
const LONGO = { message: 'Texto muito longo.' };
const TEXTO = { message: 'Texto inválido.' };
const VALIDADE = { message: 'Data de validade inválida.' };

export class CriarDocumentoDto {
  @IsString(NOME) @IsNotEmpty(NOME) @MaxLength(255, LONGO) nome!: string;
  @IsString(TIPO) @IsNotEmpty(TIPO) @MaxLength(100, LONGO) tipo!: string;
  @IsString({ message: 'Arquivo inválido.' }) @IsNotEmpty({ message: 'Arquivo inválido.' }) @MaxLength(1000, LONGO) arquivo_path!: string;
  @ValidateIf(naoNulo) @IsOptional() @IsString(TEXTO) @MaxLength(2000, LONGO) arquivo_url?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) imovel_id?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @IsISO8601({}, VALIDADE) data_validade?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @IsString(TEXTO) @MaxLength(5000, LONGO) observacoes?: string | null;
}

export class AlterarDocumentoDto {
  @ValidateIf(definido) @IsString(NOME) @IsNotEmpty(NOME) @MaxLength(255, LONGO) nome?: string;
  @ValidateIf(definido) @IsString(TIPO) @IsNotEmpty(TIPO) @MaxLength(100, LONGO) tipo?: string;
  @ValidateIf(naoNulo) @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) imovel_id?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @IsISO8601({}, VALIDADE) data_validade?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @IsString(TEXTO) @MaxLength(5000, LONGO) observacoes?: string | null;
  @ValidateIf(definido) @IsBoolean({ message: 'Valor inválido.' }) validado?: boolean;
}
