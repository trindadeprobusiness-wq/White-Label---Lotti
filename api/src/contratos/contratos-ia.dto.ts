import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export const MIMES_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
/** inline_data do Gemini aceita ~20 MB por pedido; 15M de base64 é a margem da função. */
export const MAX_BASE64 = 15_000_000;

const DADOS = { message: 'Dados do contrato inválidos.' };
const TIPO = { message: 'tipo de contrato inválido' };
const ARQUIVO = { message: 'Arquivo inválido ou muito grande' };

/** Objetos simples, sem ValidateNested: o whitelist não mexe dentro deles; o service confere como a função. */
export class GerarContratoIaDto {
  @IsString(TIPO) @IsNotEmpty(TIPO) @MaxLength(100, TIPO) tipo!: string;
  @IsOptional() @IsString(TIPO) @MaxLength(100, TIPO) tipoPersonalizado?: string;
  @IsObject(DADOS) cliente!: Record<string, unknown>;
  @IsObject(DADOS) imovel!: Record<string, unknown>;
  @IsObject(DADOS) detalhes!: Record<string, unknown>;
  @IsOptional() @IsObject(DADOS) proprietario?: Record<string, unknown>;
  @IsOptional() @IsObject(DADOS) corretor?: Record<string, unknown>;
}

export class AnalisarContratoIaDto {
  @IsString(ARQUIVO) @IsNotEmpty(ARQUIVO) @MaxLength(MAX_BASE64, ARQUIVO) fileBase64!: string;
  @IsIn(MIMES_PERMITIDOS, { message: 'Formato inválido. Envie PDF ou imagem (JPG, PNG, WEBP).' }) mimeType!: string;
  @IsOptional() @IsIn(['central'], { message: 'Modo inválido.' }) modo?: 'central';
}
