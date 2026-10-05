import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, Max,
} from 'class-validator';

export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIMITE_LISTA = 1000;
export const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const MES_REFERENCIA = /^(0[1-9]|1[0-2])\/\d{4}$/;
export const CATEGORIA = /^[A-Z][A-Z0-9_]{0,59}$/;

export const TIPOS_LANCAMENTO = ['RECEITA', 'DESPESA'] as const;
export const STATUS_LANCAMENTO = ['pago', 'pendente', 'cancelado'] as const;

export class FiltroLancamentosDto {
  @IsOptional() @IsIn(TIPOS_LANCAMENTO, { message: 'Tipo inválido.' }) tipo?: string;
  @IsOptional() @Matches(CATEGORIA, { message: 'Categoria inválida.' }) categoria?: string;
  @IsOptional() @Matches(DATA, { message: 'Data inicial inválida.' }) de?: string;
  @IsOptional() @Matches(DATA, { message: 'Data final inválida.' }) ate?: string;
}

export class CriarLancamentoDto {
  @IsIn(TIPOS_LANCAMENTO, { message: 'Tipo inválido.' }) tipo!: string;
  @Matches(CATEGORIA, { message: 'Categoria inválida.' }) categoria!: string;
  @IsString({ message: 'Informe a descrição.' }) @IsNotEmpty({ message: 'Informe a descrição.' })
  @MaxLength(500, { message: 'A descrição pode ter no máximo 500 caracteres.' }) descricao!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0, { message: 'O valor não pode ser negativo.' }) @Max(9999999999999.99, { message: 'Valor alto demais.' }) valor!: number;
  @Matches(DATA, { message: 'Data inválida.' }) data!: string;
  @IsOptional() @Matches(DATA, { message: 'Data de competência inválida.' }) data_competencia?: string;
  @IsOptional() @IsBoolean({ message: 'Recorrência inválida.' }) recorrente?: boolean;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Contrato inválido.' }) contrato_id?: string;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) imovel_id?: string;
  @IsOptional() @IsIn(STATUS_LANCAMENTO, { message: 'Status inválido.' }) status?: string;
  @IsOptional() @IsBoolean({ message: 'Indicador de DRE inválido.' }) impacta_dre?: boolean;
  @IsOptional() @IsString({ message: 'Grupo do DRE inválido.' }) @MaxLength(60, { message: 'Grupo do DRE inválido.' }) grupo_dre?: string;
  @IsOptional() @IsString({ message: 'Subcategoria inválida.' }) @MaxLength(120, { message: 'Subcategoria inválida.' }) subcategoria?: string;
}

/** Mesmos campos que useFinanceiro.updateLancamento manda hoje. */
export class AlterarLancamentoDto {
  @IsOptional() @IsIn(TIPOS_LANCAMENTO, { message: 'Tipo inválido.' }) tipo?: string;
  @IsOptional() @Matches(CATEGORIA, { message: 'Categoria inválida.' }) categoria?: string;
  @IsOptional() @IsString({ message: 'Informe a descrição.' }) @IsNotEmpty({ message: 'Informe a descrição.' })
  @MaxLength(500, { message: 'A descrição pode ter no máximo 500 caracteres.' }) descricao?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0, { message: 'O valor não pode ser negativo.' }) @Max(9999999999999.99, { message: 'Valor alto demais.' }) valor?: number;
  @IsOptional() @Matches(DATA, { message: 'Data inválida.' }) data?: string;
  @IsOptional() @IsBoolean({ message: 'Recorrência inválida.' }) recorrente?: boolean;
}

export class CriarFaturaDto {
  @Matches(FORMATO_UUID, { message: 'Contrato inválido.' }) contrato_id!: string;
  @Matches(MES_REFERENCIA, { message: 'Mês de referência inválido.' }) mes_referencia!: string;
  @Matches(DATA, { message: 'Vencimento inválido.' }) data_vencimento!: string;
}

export class VencimentoDto {
  @Matches(DATA, { message: 'Vencimento inválido.' }) data_vencimento!: string;
}

export class BaixaDto {
  @Matches(DATA, { message: 'Data de pagamento inválida.' }) data_pagamento!: string;
}

export const ACOES_ASAAS = ['emitir_cobranca', 'atualizar_cobranca', 'receber_em_dinheiro', 'desfazer_recebimento', 'excluir_cobranca'] as const;
export class AcaoAsaasDto {
  @IsIn(ACOES_ASAAS, { message: 'Ação inválida.' }) acao!: (typeof ACOES_ASAAS)[number];
  @IsOptional() @Matches(DATA, { message: 'Data de pagamento inválida.' }) data_pagamento?: string;
}

export class ConectarAsaasDto {
  @IsString({ message: 'Informe a chave de API da Asaas.' }) @IsNotEmpty({ message: 'Informe a chave de API da Asaas.' })
  @MaxLength(512, { message: 'Chave de API inválida.' }) api_key!: string;
  @IsIn(['sandbox', 'producao'], { message: 'Ambiente inválido.' }) ambiente!: 'sandbox' | 'producao';
}

/** Colunas que o POST de lançamento pode gravar; o servidor grava só as que existem no banco (D1). */
export const COLUNAS_LANCAMENTO = [
  'tipo', 'categoria', 'descricao', 'valor', 'data', 'data_competencia', 'recorrente', 'contrato_id', 'imovel_id', 'status',
  'impacta_dre', 'grupo_dre', 'subcategoria',
] as const;
/** Mesmos campos que useFinanceiro.updateLancamento manda hoje. */
export const COLUNAS_EDICAO_LANCAMENTO = ['tipo', 'categoria', 'descricao', 'valor', 'data', 'recorrente'] as const;
