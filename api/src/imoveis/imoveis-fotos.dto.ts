import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min,
  ValidateIf,
} from 'class-validator';

/** Teto de fotos por imóvel numa lista, e de ids numa reordenação. */
export const LIMITE_FOTOS = 1000;
/** Teto de imóveis por pedido de miniaturas (o mesmo da lista de imóveis). */
export const LIMITE_IMOVEIS_RESUMO = 1000;
/** Teto de linhas das miniaturas: protege o servidor; a lista de imóveis já vem limitada a 1000. */
export const LIMITE_LINHAS_RESUMO = 10000;

const definido = (_o: unknown, v: unknown) => v !== undefined;
const NUMERO = { allowNaN: false, allowInfinity: false };
/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O text do Postgres recusa \u0000 (22021, que viraria 500): nenhum caractere de controle no caminho ou na URL. */
const SEM_CONTROLE = /^[^\u0000-\u001f\u007f]+$/;

export class CriarFotoDto {
  @IsString({ message: 'Caminho da foto inválido.' })
  @IsNotEmpty({ message: 'Caminho da foto inválido.' })
  @MaxLength(1024, { message: 'Caminho da foto inválido.' })
  @Matches(SEM_CONTROLE, { message: 'Caminho da foto inválido.' })
  arquivo_path!: string;

  @IsString({ message: 'Endereço da foto inválido.' })
  @MaxLength(2048, { message: 'Endereço da foto inválido.' })
  @Matches(/^https?:\/\/[^\u0000-\u001f\u007f\s]+$/i, { message: 'Endereço da foto inválido.' })
  arquivo_url!: string;

  @ValidateIf(definido) @IsBoolean({ message: 'Valor inválido para principal.' }) principal?: boolean;
}

export class OrdemFotosDto {
  @IsArray({ message: 'Informe as fotos na ordem.' })
  @ArrayMinSize(1, { message: 'Informe as fotos na ordem.' })
  @ArrayMaxSize(LIMITE_FOTOS, { message: 'Fotos demais de uma vez.' })
  @ArrayUnique({ message: 'A mesma foto apareceu duas vezes na ordem.' })
  @Matches(FORMATO_UUID, { each: true, message: 'Foto inválida.' })
  ids!: string[];
}

export class ResumoFotosDto {
  @IsArray({ message: 'Informe os imóveis.' })
  @ArrayMinSize(1, { message: 'Informe os imóveis.' })
  @ArrayMaxSize(LIMITE_IMOVEIS_RESUMO, { message: 'Imóveis demais de uma vez.' })
  @Matches(FORMATO_UUID, { each: true, message: 'Imóvel inválido.' })
  imovel_ids!: string[];
}

/** Evento de conversão (UTMify) da venda: o servidor monta o payload com os dados do banco. */
export class EventoVendaDto {
  @ValidateIf(definido)
  @IsNumber(NUMERO, { message: 'Informe o valor da venda.' })
  @Min(0, { message: 'O valor da venda não pode ser negativo.' })
  @Max(9999999999999.99, { message: 'Valor muito alto.' })
  valor?: number;

  @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
}
