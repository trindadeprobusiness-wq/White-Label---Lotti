import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min,
  ValidateIf, ValidateNested,
} from 'class-validator';

export const LIMITE_LISTA = 1000;
/** enum public.tipo_contrato (MIG:103); SEM 'OUTRO'. */
export const TIPOS_CONTRATO = ['COMPRA_VENDA', 'LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL', 'EXCLUSIVIDADE_VENDA', 'EXCLUSIVIDADE_LOCACAO', 'DISTRATO', 'PROCURACAO'] as const;
export const TIPOS_LOCACAO = ['LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL'] as const;
/** Valores em uso; a coluna não tem CHECK. */
export const STATUS_CONTRATO = ['RASCUNHO', 'ATIVO', 'VIGENTE', 'ENCERRADO'] as const;
export const COLUNAS_CRIACAO = [
  'tipo', 'cliente_id', 'imovel_id', 'valor', 'data_inicio', 'data_fim', 'prazo_meses', 'dia_vencimento', 'indice_reajuste', 'conteudo',
  'status', 'observacoes', 'arquivo_url', 'taxa_administracao_percentual', 'multa_atraso_percentual', 'juros_mora_diario_percentual',
  'dia_vencimento_aluguel', 'dia_repasse_proprietario',
] as const;
export const COLUNAS_LOCACAO = [
  'tipo', 'cliente_id', 'imovel_id', 'valor', 'data_inicio', 'dia_vencimento', 'conteudo', 'arquivo_url', 'multa_atraso_percentual',
  'juros_mora_diario_percentual',
] as const;
export const COLUNAS_ALTERACAO = ['status', 'arquivo_url', 'observacoes', 'data_fim'] as const;

/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Data sem hora; a validade de calendário (31/02) fica para o banco (22008 → 400). */
export const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Opcional que NÃO aceita null: só pula quando ausente. */
export const definido = (_o: unknown, v: unknown) => v !== undefined;
/** Anulável: null passa e grava NULL. */
export const naoNulo = (_o: unknown, v: unknown) => v !== null;

const MAX_VALOR = 9999999999999.99;
const M = {
  cliente: { message: 'Cliente inválido.' },
  imovel: { message: 'Imóvel inválido.' },
  tipo: { message: 'Tipo de contrato inválido.' },
  valor: { message: 'Informe um valor válido.' },
  inicio: { message: 'Data de início inválida.' },
  fim: { message: 'Data de término inválida.' },
  vencimento: { message: 'Data de vencimento inválida.' },
  dia: { message: 'Dia de vencimento inválido.' },
  pct: { message: 'Percentual inválido.' },
  longo: { message: 'Texto muito longo.' },
  texto: { message: 'Texto inválido.' },
  status: { message: 'Status do contrato inválido.' },
  prazo: { message: 'Prazo inválido.' },
} as const;

export class ListarLocacaoDto {
  @IsOptional() @IsIn(TIPOS_LOCACAO, M.tipo) tipo?: string;
}

export class ContratosDosClientesDto {
  @IsArray({ message: 'Informe os clientes.' })
  @ArrayMinSize(1, { message: 'Informe os clientes.' })
  @ArrayMaxSize(LIMITE_LISTA, { message: 'Clientes demais de uma vez.' })
  @Matches(FORMATO_UUID, { each: true, message: 'Cliente inválido.' })
  cliente_ids!: string[];
}

export class CriarContratoDto {
  @IsIn(TIPOS_CONTRATO, M.tipo) tipo!: string;
  @ValidateIf(naoNulo) @IsOptional() @Matches(FORMATO_UUID, M.cliente) cliente_id?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @Matches(FORMATO_UUID, M.imovel) imovel_id?: string | null;
  @IsNumber({}, M.valor) @Min(0, M.valor) @Max(MAX_VALOR, M.valor) valor!: number;
  @Matches(FORMATO_DATA, M.inicio) data_inicio!: string;
  @ValidateIf(naoNulo) @IsOptional() @Matches(FORMATO_DATA, M.fim) data_fim?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @IsInt(M.prazo) @Min(0, M.prazo) @Max(1200, M.prazo) prazo_meses?: number | null;
  @ValidateIf(naoNulo) @IsOptional() @IsInt(M.dia) @Min(1, M.dia) @Max(31, M.dia) dia_vencimento?: number | null;
  @ValidateIf(naoNulo) @IsOptional() @IsString(M.texto) @MaxLength(50, M.longo) indice_reajuste?: string | null;
  @IsString(M.texto) @MaxLength(200000, M.longo) conteudo!: string; // '' é aceito
  @ValidateIf(definido) @IsIn(STATUS_CONTRATO, M.status) status?: string;
  @ValidateIf(naoNulo) @IsOptional() @IsString(M.texto) @MaxLength(5000, M.longo) observacoes?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @IsString(M.texto) @MaxLength(1000, M.longo) arquivo_url?: string | null;
  @ValidateIf(definido) @IsNumber({}, M.pct) @Min(0, M.pct) @Max(100, M.pct) taxa_administracao_percentual?: number;
  @ValidateIf(definido) @IsNumber({}, M.pct) @Min(0, M.pct) @Max(100, M.pct) multa_atraso_percentual?: number;
  @ValidateIf(definido) @IsNumber({}, M.pct) @Min(0, M.pct) @Max(100, M.pct) juros_mora_diario_percentual?: number;
  @ValidateIf(naoNulo) @IsOptional() @IsInt(M.dia) @Min(1, M.dia) @Max(31, M.dia) dia_vencimento_aluguel?: number | null;
  @ValidateIf(naoNulo) @IsOptional() @IsInt(M.dia) @Min(1, M.dia) @Max(31, M.dia) dia_repasse_proprietario?: number | null;
}

export class PrimeiraFaturaDto {
  @Matches(FORMATO_DATA, M.vencimento) data_vencimento!: string;
  @Matches(/^(0[1-9]|1[0-2])\/\d{4}$/, { message: 'Mês de referência inválido.' }) mes_referencia!: string;
}

/** Campos comuns a criar e editar locação (a tela sempre manda o objeto inteiro). */
export class EditarLocacaoDto {
  @ValidateIf(definido) @IsIn(TIPOS_LOCACAO, M.tipo) tipo?: string;
  @Matches(FORMATO_UUID, M.cliente) cliente_id!: string;
  @Matches(FORMATO_UUID, M.imovel) imovel_id!: string;
  @IsNumber({}, M.valor) @Min(0.01, M.valor) @Max(MAX_VALOR, M.valor) valor!: number;
  @Matches(FORMATO_DATA, M.inicio) data_inicio!: string;
  @IsInt(M.dia) @Min(1, M.dia) @Max(31, M.dia) dia_vencimento!: number;
  @IsString(M.texto) @MaxLength(200000, M.longo) conteudo!: string;
  @ValidateIf(naoNulo) @IsOptional() @IsString(M.texto) @MaxLength(1000, M.longo) arquivo_url?: string | null;
  @ValidateIf(definido) @IsNumber({}, M.pct) @Min(0, M.pct) @Max(100, M.pct) multa_atraso_percentual?: number;
  @ValidateIf(definido) @IsNumber({}, M.pct) @Min(0, M.pct) @Max(100, M.pct) juros_mora_diario_percentual?: number;
}

export class CriarLocacaoDto extends EditarLocacaoDto {
  @IsObject({ message: 'Informe a primeira fatura.' })
  @ValidateNested({ message: 'Informe a primeira fatura.' })
  @Type(() => PrimeiraFaturaDto)
  primeira_fatura!: PrimeiraFaturaDto;
}

export class AlterarContratoDto {
  @ValidateIf(definido) @IsIn(STATUS_CONTRATO, M.status) status?: string;
  @ValidateIf(naoNulo) @IsOptional() @IsString(M.texto) @MaxLength(1000, M.longo) arquivo_url?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @IsString(M.texto) @MaxLength(5000, M.longo) observacoes?: string | null;
  @ValidateIf(naoNulo) @IsOptional() @Matches(FORMATO_DATA, M.fim) data_fim?: string | null;
}
