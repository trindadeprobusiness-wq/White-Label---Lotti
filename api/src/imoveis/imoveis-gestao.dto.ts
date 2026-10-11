import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsUrl, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateBy, ValidateIf, ValidationOptions,
} from 'class-validator';
import { FINALIDADES, TIPOS } from './busca-imoveis.dto';

export const LIMITE_LISTA = 1000;
export const COLUNAS_CRIACAO = [
  'titulo', 'tipo', 'finalidade', 'valor', 'area_m2', 'dormitorios', 'garagem', 'suites', 'banheiros',
  'endereco', 'bairro', 'cidade', 'proprietario_nome', 'ativo', 'links_anuncio',
] as const;
// descricao fica de fora de propósito: quem grava é o fluxo de fotos com IA (OrganizarFotosIA), ainda no Supabase.
export const COLUNAS_EDICAO = [
  'titulo', 'tipo', 'finalidade', 'valor', 'area_m2', 'dormitorios', 'garagem', 'suites', 'banheiros',
  'endereco', 'bairro', 'cidade', 'proprietario_nome', 'anunciado', 'links_anuncio',
] as const;

const definido = (_o: unknown, v: unknown) => v !== undefined;
const NUMERO = { allowNaN: false, allowInfinity: false };
/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_TIPO = 'Tipo de imóvel inválido. Use apartamento, casa, comercial ou terreno.';
const MSG_FINALIDADE = 'Finalidade inválida. Use venda, locação ou ambos.';

/**
 * O jsonb recusa \u0000 (SQLSTATE 22P05), que o tradutor comum de erros não cobre: sem esta regra o texto passaria
 * na validação e viraria 500. Só olha strings: tipo errado já tem a mensagem do IsString.
 */
function SemCaractereNulo(opcoes: ValidationOptions): PropertyDecorator {
  return ValidateBy({
    name: 'semCaractereNulo',
    validator: { validate: (v: unknown) => typeof v !== 'string' || !v.includes('\u0000') },
  }, opcoes);
}
const SEM_NUL = {
  titulo: { message: 'O título tem um caractere inválido.' },
  endereco: { message: 'O endereço tem um caractere inválido.' },
  bairro: { message: 'O bairro tem um caractere inválido.' },
  cidade: { message: 'A cidade tem um caractere inválido.' },
  proprietario_nome: { message: 'O nome do proprietário tem um caractere inválido.' },
};

export class CriarImovelDto {
  @IsString({ message: 'Informe o título do imóvel.' }) @IsNotEmpty({ message: 'Informe o título do imóvel.' }) @MaxLength(300, { message: 'O título pode ter até 300 caracteres.' }) @SemCaractereNulo(SEM_NUL.titulo) titulo!: string;
  @IsIn(TIPOS, { message: MSG_TIPO }) tipo!: (typeof TIPOS)[number];
  @ValidateIf(definido) @IsIn(FINALIDADES, { message: MSG_FINALIDADE }) finalidade?: (typeof FINALIDADES)[number];
  @IsNumber(NUMERO, { message: 'Informe o valor do imóvel.' }) @Min(0, { message: 'O valor não pode ser negativo.' }) @Max(9999999999999.99, { message: 'Valor muito alto.' }) valor!: number;
  @IsOptional() @IsNumber(NUMERO, { message: 'Área inválida.' }) @Min(0, { message: 'Área inválida.' }) @Max(99999999.99, { message: 'Área inválida.' }) area_m2?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de dormitórios inválida.' }) @Min(0, { message: 'Quantidade de dormitórios inválida.' }) @Max(999, { message: 'Quantidade de dormitórios inválida.' }) dormitorios?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de vagas inválida.' }) @Min(0, { message: 'Quantidade de vagas inválida.' }) @Max(999, { message: 'Quantidade de vagas inválida.' }) garagem?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de suítes inválida.' }) @Min(0, { message: 'Quantidade de suítes inválida.' }) @Max(999, { message: 'Quantidade de suítes inválida.' }) suites?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de banheiros inválida.' }) @Min(0, { message: 'Quantidade de banheiros inválida.' }) @Max(999, { message: 'Quantidade de banheiros inválida.' }) banheiros?: number | null;
  // '' é aceito em endereco, cidade e proprietario_nome: o banco aceita e o NovoImovelDialog manda proprietario_nome ''.
  @IsString({ message: 'Informe o endereço.' }) @MaxLength(500, { message: 'O endereço pode ter até 500 caracteres.' }) @SemCaractereNulo(SEM_NUL.endereco) endereco!: string;
  @IsOptional() @IsString({ message: 'Bairro inválido.' }) @MaxLength(200, { message: 'O bairro pode ter até 200 caracteres.' }) @SemCaractereNulo(SEM_NUL.bairro) bairro?: string | null;
  @IsString({ message: 'Informe a cidade.' }) @MaxLength(200, { message: 'A cidade pode ter até 200 caracteres.' }) @SemCaractereNulo(SEM_NUL.cidade) cidade!: string;
  @IsString({ message: 'Informe o nome do proprietário.' }) @MaxLength(300, { message: 'O nome do proprietário pode ter até 300 caracteres.' }) @SemCaractereNulo(SEM_NUL.proprietario_nome) proprietario_nome!: string;
  @ValidateIf(definido) @IsBoolean({ message: 'Valor inválido para ativo.' }) ativo?: boolean;
  /** Links do anúncio nos portais (OLX, ImovelWeb...): só http(s), até 10. */
  @IsOptional() @IsArray({ message: 'Links de anúncio inválidos.' }) @ArrayMaxSize(10, { message: 'Até 10 links de anúncio.' }) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true, message: 'Link de anúncio inválido. Use o endereço completo, com https://.' }) @MaxLength(500, { each: true, message: 'Link de anúncio muito longo.' }) links_anuncio?: string[];
}

export class AtualizarImovelDto {
  @ValidateIf(definido) @IsString({ message: 'Informe o título do imóvel.' }) @IsNotEmpty({ message: 'Informe o título do imóvel.' }) @MaxLength(300, { message: 'O título pode ter até 300 caracteres.' }) @SemCaractereNulo(SEM_NUL.titulo) titulo?: string;
  @ValidateIf(definido) @IsIn(TIPOS, { message: MSG_TIPO }) tipo?: (typeof TIPOS)[number];
  @ValidateIf(definido) @IsIn(FINALIDADES, { message: MSG_FINALIDADE }) finalidade?: (typeof FINALIDADES)[number];
  @ValidateIf(definido) @IsNumber(NUMERO, { message: 'Informe o valor do imóvel.' }) @Min(0, { message: 'O valor não pode ser negativo.' }) @Max(9999999999999.99, { message: 'Valor muito alto.' }) valor?: number;
  @IsOptional() @IsNumber(NUMERO, { message: 'Área inválida.' }) @Min(0, { message: 'Área inválida.' }) @Max(99999999.99, { message: 'Área inválida.' }) area_m2?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de dormitórios inválida.' }) @Min(0, { message: 'Quantidade de dormitórios inválida.' }) @Max(999, { message: 'Quantidade de dormitórios inválida.' }) dormitorios?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de vagas inválida.' }) @Min(0, { message: 'Quantidade de vagas inválida.' }) @Max(999, { message: 'Quantidade de vagas inválida.' }) garagem?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de suítes inválida.' }) @Min(0, { message: 'Quantidade de suítes inválida.' }) @Max(999, { message: 'Quantidade de suítes inválida.' }) suites?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de banheiros inválida.' }) @Min(0, { message: 'Quantidade de banheiros inválida.' }) @Max(999, { message: 'Quantidade de banheiros inválida.' }) banheiros?: number | null;
  @ValidateIf(definido) @IsString({ message: 'Informe o endereço.' }) @MaxLength(500, { message: 'O endereço pode ter até 500 caracteres.' }) @SemCaractereNulo(SEM_NUL.endereco) endereco?: string;
  @IsOptional() @IsString({ message: 'Bairro inválido.' }) @MaxLength(200, { message: 'O bairro pode ter até 200 caracteres.' }) @SemCaractereNulo(SEM_NUL.bairro) bairro?: string | null;
  @ValidateIf(definido) @IsString({ message: 'Informe a cidade.' }) @MaxLength(200, { message: 'A cidade pode ter até 200 caracteres.' }) @SemCaractereNulo(SEM_NUL.cidade) cidade?: string;
  @ValidateIf(definido) @IsString({ message: 'Informe o nome do proprietário.' }) @MaxLength(300, { message: 'O nome do proprietário pode ter até 300 caracteres.' }) @SemCaractereNulo(SEM_NUL.proprietario_nome) proprietario_nome?: string;
  @ValidateIf(definido) @IsBoolean({ message: 'Valor inválido para anunciado.' }) anunciado?: boolean;
  /** Links do anúncio nos portais (OLX, ImovelWeb...): só http(s), até 10. */
  @IsOptional() @IsArray({ message: 'Links de anúncio inválidos.' }) @ArrayMaxSize(10, { message: 'Até 10 links de anúncio.' }) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true, message: 'Link de anúncio inválido. Use o endereço completo, com https://.' }) @MaxLength(500, { each: true, message: 'Link de anúncio muito longo.' }) links_anuncio?: string[];
}

export class RegistrarVendaDto {
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
}
