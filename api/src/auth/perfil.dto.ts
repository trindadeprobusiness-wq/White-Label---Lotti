import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';

/**
 * Colunas de public.corretores que o próprio corretor edita (Configurações → Perfil e a foto).
 * É exatamente o que a tela manda hoje ao Supabase (corretorSchema + foto_url). Fora daqui, de
 * propósito: status/suspensão (ação administrativa, protegida também pelo gatilho), user_id,
 * preferencias, ultimo_acesso_em e os campos do onboarding.
 */
export const COLUNAS_PERFIL_CORRETOR = [
  'nome', 'creci', 'creci_estado', 'email', 'telefone', 'endereco', 'website',
  'razao_social', 'cnpj_cpf', 'endereco_completo', 'foto_url',
] as const;

const aparar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const definido = (_o: unknown, v: unknown) => v !== undefined;

export class AtualizarCorretorDto {
  @ValidateIf(definido) @Transform(aparar)
  @IsString({ message: 'Informe o nome.' }) @Length(1, 200, { message: 'Informe o nome (até 200 caracteres).' })
  nome?: string;

  @ValidateIf(definido) @Transform(aparar)
  @IsString({ message: 'CRECI inválido.' }) @Length(1, 30, { message: 'CRECI inválido.' })
  creci?: string;

  @ValidateIf(definido) @Transform(aparar)
  @IsString({ message: 'Use a sigla do estado (ex: SP).' }) @Length(2, 2, { message: 'Use a sigla do estado (ex: SP).' })
  creci_estado?: string;

  @ValidateIf(definido) @Transform(aparar)
  @IsEmail({}, { message: 'Email inválido' }) @MaxLength(320, { message: 'Email inválido' })
  email?: string;

  @ValidateIf(definido) @Transform(aparar)
  @IsString({ message: 'Telefone inválido.' }) @MaxLength(32, { message: 'Telefone inválido.' })
  telefone?: string;

  @IsOptional()
  @IsString({ message: 'Endereço inválido.' }) @MaxLength(500, { message: 'O endereço pode ter até 500 caracteres.' })
  endereco?: string | null;

  @IsOptional()
  @IsString({ message: 'URL inválida' }) @MaxLength(500, { message: 'URL inválida' })
  website?: string | null;

  @IsOptional()
  @IsString({ message: 'Razão social inválida.' }) @MaxLength(300, { message: 'A razão social pode ter até 300 caracteres.' })
  razao_social?: string | null;

  @IsOptional()
  @IsString({ message: 'CPF ou CNPJ inválido' }) @MaxLength(32, { message: 'CPF ou CNPJ inválido' })
  cnpj_cpf?: string | null;

  @IsOptional()
  @IsString({ message: 'Endereço inválido.' }) @MaxLength(1000, { message: 'O endereço completo pode ter até 1000 caracteres.' })
  endereco_completo?: string | null;

  /** A tela grava a foto como data URL (arquivo até 2 MB ≈ 2,8 milhões de caracteres em base64). */
  @IsOptional()
  @IsString({ message: 'Foto inválida.' }) @MaxLength(3_000_000, { message: 'A foto pode ter até 2 MB.' })
  foto_url?: string | null;
}

export const TIPOS_ATIVIDADE = ['login', 'sessao', 'acao'] as const;

/** Mesmos tipos que public.registrar_atividade aceita; a rota é cortada em 200 pela função. */
export class RegistrarAtividadeDto {
  @IsIn(TIPOS_ATIVIDADE, { message: 'Tipo de atividade inválido.' })
  tipo!: (typeof TIPOS_ATIVIDADE)[number];

  @IsOptional()
  @IsString({ message: 'Rota inválida.' }) @MaxLength(2000, { message: 'Rota inválida.' })
  rota?: string | null;
}
