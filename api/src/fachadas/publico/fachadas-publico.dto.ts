import { Transform } from 'class-transformer';
import {
  IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength,
  registerDecorator, ValidationArguments, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Tradução literal de guard_public_fachada_insert: tira não-dígitos e o 55 de 12/13 dígitos.
 * Só valida — o telefone GRAVADO é o que o visitante digitou (contrato §2.3).
 */
export function normalizarTelefone(valor: string): string {
  const digitos = valor.replace(/\D/g, '');
  return (digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55') ? digitos.slice(2) : digitos;
}

/** Aplicado ao resultado de normalizarTelefone, como o gatilho faz. */
export const TELEFONE_VALIDO = /^[1-9][0-9]{9,10}$/;
/** O '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' do gatilho, com [:space:] virando \s. */
export const EMAIL_PUBLICO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@ValidatorConstraint({ name: 'telefonePublico', async: false })
export class TelefonePublicoConstraint implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    return typeof valor === 'string' && TELEFONE_VALIDO.test(normalizarTelefone(valor));
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Informe um telefone válido com DDD.';
  }
}

export function TelefonePublico(options?: ValidationOptions) {
  return function registrar(alvo: object, propriedade: string): void {
    registerDecorator({
      target: alvo.constructor, propertyName: propriedade, options, validator: TelefonePublicoConstraint,
    });
  };
}

const aparar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Repete, EM CIMA do gatilho (nunca em lugar dele), as fronteiras de guard_public_fachada_insert,
 * para o visitante receber 400 em português em vez de 500. Se as duas discordarem, quem decide é o banco.
 */
export class EnviarLeadDto {
  @Transform(aparar)
  @IsString({ message: 'Informe seu nome.' })
  @IsNotEmpty({ message: 'Informe seu nome.' })
  @MinLength(2, { message: 'Informe seu nome completo.' })
  @MaxLength(120, { message: 'Nome muito longo.' })
  nome!: string;

  @IsString({ message: 'Informe seu telefone.' })
  @IsNotEmpty({ message: 'Informe seu telefone.' })
  @MaxLength(32, { message: 'Telefone muito longo.' })
  @TelefonePublico({ message: 'Informe um telefone válido com DDD.' })
  telefone!: string;

  // email: '' não passa pelo @IsOptional (string vazia não é undefined) e é recusado: divergência
  // deliberada do gatilho, a mais restritiva das duas (contrato §2.3, §6.5).
  @IsOptional()
  @IsString({ message: 'Informe um e-mail válido.' })
  @MaxLength(254, { message: 'E-mail muito longo.' })
  @Matches(EMAIL_PUBLICO, { message: 'Informe um e-mail válido.' })
  email?: string;
}
