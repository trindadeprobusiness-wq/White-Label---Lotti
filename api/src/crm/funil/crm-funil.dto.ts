import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

export const TIPOS_ETAPA = ['ABERTA', 'GANHO', 'PERDIDO'] as const;
export const TIPOS_TAREFA = ['LIGACAO', 'WHATSAPP', 'EMAIL', 'REUNIAO', 'VISITA', 'PROPOSTA', 'OUTRO'] as const;
export const LIMITE_LISTA = 1000;
export const COLUNAS_NOVA_OPORTUNIDADE = [
  'etapa_id', 'titulo', 'cliente_id', 'imovel_id', 'valor_estimado', 'probabilidade',
  'data_prevista_fechamento', 'motivo_perda', 'origem', 'ordem', 'observacoes',
] as const;
export const COLUNAS_NOVA_TAREFA = ['titulo', 'descricao', 'tipo', 'data_prevista', 'oportunidade_id', 'cliente_id'] as const;

const definido = (_o: unknown, v: unknown) => v !== undefined;
const NUMERO = { allowNaN: false, allowInfinity: false };
/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EtapaEditadaDto {
  @Matches(FORMATO_UUID, { message: 'Etapa inválida.' }) id!: string;
  @IsString({ message: 'Informe o nome da etapa.' }) @IsNotEmpty({ message: 'Informe o nome da etapa.' }) @MaxLength(60, { message: 'O nome da etapa pode ter até 60 caracteres.' }) nome!: string;
  @IsString({ message: 'Cor inválida.' }) @Matches(/^[a-z]{2,20}$/, { message: 'Cor inválida.' }) cor!: string;
  @IsIn(TIPOS_ETAPA, { message: 'Tipo de etapa inválido.' }) tipo!: string;
  @IsInt({ message: 'Ordem inválida.' }) @Min(0, { message: 'Ordem inválida.' }) @Max(1000, { message: 'Ordem inválida.' }) ordem!: number;
}

export class SalvarEtapasDto {
  @IsArray({ message: 'Envie a lista de etapas.' }) @ArrayMinSize(1, { message: 'Envie ao menos uma etapa.' }) @ArrayMaxSize(50, { message: 'Envie no máximo 50 etapas.' })
  @ValidateNested({ each: true, message: 'Etapa inválida.' }) @Type(() => EtapaEditadaDto) etapas!: EtapaEditadaDto[];
}

export class MoverOportunidadeDto {
  @Matches(FORMATO_UUID, { message: 'Etapa inválida.' }) etapa_id!: string;
  @IsInt({ message: 'Posição inválida.' }) @Min(0, { message: 'Posição inválida.' }) @Max(100000, { message: 'Posição inválida.' }) ordem!: number;
  // Token de concorrência: a string exatamente como veio da listagem (com microssegundos).
  @IsString({ message: 'Versão do negócio ausente.' }) @IsNotEmpty({ message: 'Versão do negócio ausente.' }) @MaxLength(64, { message: 'Versão do negócio inválida.' }) updated_at!: string;
}

export class ExcluirOportunidadesDto {
  // Mesmo teto da listagem: toda seleção possível no CrmPipeline cabe numa chamada.
  @IsArray({ message: 'Escolha ao menos um negócio.' }) @ArrayMinSize(1, { message: 'Escolha ao menos um negócio.' }) @ArrayMaxSize(LIMITE_LISTA, { message: 'Escolha no máximo 1000 negócios por vez.' })
  @Matches(FORMATO_UUID, { each: true, message: 'Negócio inválido.' }) ids!: string[];
}

export class CriarOportunidadeDto {
  @Matches(FORMATO_UUID, { message: 'Etapa inválida.' }) etapa_id!: string;
  @IsString({ message: 'Informe o título.' }) @IsNotEmpty({ message: 'Informe o título.' }) @MaxLength(200, { message: 'O título pode ter até 200 caracteres.' }) titulo!: string;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) imovel_id?: string | null;
  @ValidateIf(definido) @IsNumber(NUMERO, { message: 'Valor inválido.' }) @Min(0, { message: 'Valor inválido.' }) @Max(9999999999999.99, { message: 'Valor inválido.' }) valor_estimado?: number;
  @ValidateIf(definido) @IsInt({ message: 'Probabilidade inválida.' }) @Min(0, { message: 'Probabilidade inválida.' }) @Max(100, { message: 'Probabilidade inválida.' }) probabilidade?: number;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { message: 'Data prevista inválida.' }) data_prevista_fechamento?: string | null;
  @IsOptional() @IsString({ message: 'Motivo da perda inválido.' }) @MaxLength(500, { message: 'O motivo da perda pode ter até 500 caracteres.' }) motivo_perda?: string | null;
  @IsOptional() @IsString({ message: 'Origem inválida.' }) @MaxLength(50, { message: 'Origem inválida.' }) origem?: string | null;
  @ValidateIf(definido) @IsInt({ message: 'Posição inválida.' }) @Min(0, { message: 'Posição inválida.' }) @Max(100000, { message: 'Posição inválida.' }) ordem?: number;
  @IsOptional() @IsString({ message: 'Observações inválidas.' }) @MaxLength(5000, { message: 'As observações podem ter até 5000 caracteres.' }) observacoes?: string | null;
}

export class ConcluirTarefaDto {
  @IsBoolean({ message: 'Informe se a tarefa foi concluída.' }) concluida!: boolean;
}

export class CriarTarefaDto {
  @IsString({ message: 'Informe o título da tarefa.' }) @IsNotEmpty({ message: 'Informe o título da tarefa.' }) @MaxLength(200, { message: 'O título pode ter até 200 caracteres.' }) titulo!: string;
  @IsOptional() @IsString({ message: 'Descrição inválida.' }) @MaxLength(5000, { message: 'A descrição pode ter até 5000 caracteres.' }) descricao?: string | null;
  @ValidateIf(definido) @IsIn(TIPOS_TAREFA, { message: 'Tipo de tarefa inválido.' }) tipo?: string;
  @IsOptional() @IsISO8601({}, { message: 'Data prevista inválida.' }) data_prevista?: string | null;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Negócio inválido.' }) oportunidade_id?: string | null;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
}
