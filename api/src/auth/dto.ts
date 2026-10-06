import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength, ValidateBy, ValidationOptions } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  senha!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(320)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @MaxLength(200)
  senha!: string;
}

const aparar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Dígitos verificadores do CNPJ: mesma regra de validarCNPJ (src/lib/validators.ts) do formulário do front. */
export function cnpjValido(valor: string): boolean {
  const d = valor.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const digito = (n: number): number => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

function Cnpj(opcoes: ValidationOptions): PropertyDecorator {
  return ValidateBy({ name: 'cnpj', validator: { validate: (v: unknown) => typeof v === 'string' && cnpjValido(v) } }, opcoes);
}

/** Telefone com DDD: 10 ou 11 dígitos, como o cadastroSchema do front. */
function TelefoneBr(opcoes: ValidationOptions): PropertyDecorator {
  return ValidateBy({
    name: 'telefoneBr',
    validator: { validate: (v: unknown) => typeof v === 'string' && [10, 11].includes(v.replace(/\D/g, '').length) },
  }, opcoes);
}

/**
 * Cadastro de conta (POST /api/auth/cadastro). Regras iguais às do formulário de hoje
 * (src/lib/auth/validacao.ts → cadastroSchema), para a tela e a API recusarem a mesma coisa.
 * A senha tem teto de 72: o bcrypt ignora o que passa disso.
 */
export class CadastroDto {
  @Transform(aparar)
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(320, { message: 'E-mail inválido' })
  email!: string;

  @IsString({ message: 'Senha deve ter pelo menos 6 caracteres' })
  @MinLength(6, { message: 'Senha deve ter pelo menos 6 caracteres' })
  @MaxLength(72, { message: 'A senha pode ter até 72 caracteres.' })
  senha!: string;

  @Transform(aparar)
  @IsString({ message: 'Nome deve ter pelo menos 3 caracteres' })
  @MinLength(3, { message: 'Nome deve ter pelo menos 3 caracteres' })
  @MaxLength(200, { message: 'O nome pode ter até 200 caracteres.' })
  nome!: string;

  @Transform(aparar)
  @Cnpj({ message: 'CNPJ inválido' })
  @MaxLength(32, { message: 'CNPJ inválido' })
  cnpj!: string;

  @Transform(aparar)
  @TelefoneBr({ message: 'Telefone inválido' })
  @MaxLength(32, { message: 'Telefone inválido' })
  telefone!: string;
}
