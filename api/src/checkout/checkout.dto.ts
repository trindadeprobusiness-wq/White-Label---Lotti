import { Transform } from 'class-transformer';
import {
  IsEmail, IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length, Matches, Max, MaxLength, MinLength,
} from 'class-validator';

/**
 * Corpos das rotas do checkout do site (servidor a servidor). Nomes em snake_case, iguais às
 * colunas de public.checkout_orders e aos parâmetros das RPCs que o site chamava no Supabase.
 * Os valores aceitos espelham os CHECKs da tabela (0_init).
 */
export const PLANOS = ['essencial', 'profissional', 'imobiliaria'] as const;
export const CICLOS = ['monthly', 'annual'] as const;
export const METODOS = ['PIX', 'CREDIT_CARD'] as const;
/** Só os estados que o site grava. active/overdue/refunded vêm de apply_checkout_payment. */
export const STATUS_DO_SITE = ['creating', 'awaiting_payment', 'processing', 'failed'] as const;
export const FIM_DE_EVENTO = ['processed', 'ignored', 'failed'] as const;

const minusculo = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Chave do limite: HMAC-SHA256 hex do IP, feita no site (a API nunca vê o IP do comprador). */
export class LimiteDto {
  @IsString()
  @MaxLength(128)
  chave!: string;
}

export class CriarPedidoDto {
  @IsUUID()
  id!: string;

  /** SHA-256 hex do token de status do navegador (o token cru fica no site). */
  @Matches(/^[a-f0-9]{64}$/)
  access_token_hash!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  payer_name!: string;

  @Transform(minusculo)
  @IsEmail()
  @MaxLength(320)
  payer_email!: string;

  @Matches(/^(\d{11}|\d{14})$/)
  payer_document!: string;

  @Matches(/^\d{10,11}$/)
  payer_phone!: string;

  @IsIn(PLANOS)
  plan_code!: string;

  @IsIn(CICLOS)
  billing_cycle!: string;

  @IsIn(METODOS)
  payment_method!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(99_999_999)
  amount!: number;
}

/**
 * Campos que o site atualiza no pedido. provisioned_user_id e access_email_sent_at ficam de
 * fora de propósito: só o provisionamento da API liga um pedido a uma conta.
 * `null` em failure_code limpa a coluna; campo ausente não mexe.
 */
export class AtualizarPedidoDto {
  @IsOptional()
  @IsIn(STATUS_DO_SITE)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  asaas_customer_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  asaas_subscription_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  asaas_payment_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  failure_code?: string | null;
}

export class BuscarPedidoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  assinatura!: string;
}

/** Cobrança do Asaas como o webhook a leu (status já com DELETED quando a cobrança foi apagada). */
export class PagamentoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  payment_id!: string;

  @IsString()
  @MaxLength(100)
  customer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subscription?: string | null;

  @IsString()
  @MaxLength(40)
  status!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  due_date!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  amount!: number;
}

export class ReservarEventoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  event_type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  payment_id?: string | null;
}

export class ConcluirEventoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  id!: string;

  @IsIn(FIM_DE_EVENTO)
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  error_code?: string | null;
}

export class BuscarContaDto {
  @Transform(minusculo)
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

/** Token de status do navegador (o mesmo que o site confere): a API refaz a conferência. */
export class LinkSenhaDto {
  @IsString()
  @Length(32, 128)
  token!: string;
}
