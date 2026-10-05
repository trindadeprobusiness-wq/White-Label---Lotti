import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ERROS_ARQUIVO } from '../storage/storage.erros';

/**
 * Valida a key que chega como splat (`*key`). Recusa vazia, com `..`, com `\`, começando em `/`,
 * com segmento vazio (`//`) ou com mais de 1024 caracteres. Devolve a key canônica (a mesma string),
 * que nunca é concatenada em SQL nem em shell — vai sempre como parâmetro do comando S3/consulta.
 */
export function validarKey(bruto: unknown): string {
  if (typeof bruto !== 'string') throw ERROS_ARQUIVO.keyInvalida();
  const key = bruto;
  if (key.length === 0 || key.length > 1024) throw ERROS_ARQUIVO.keyInvalida();
  if (key.startsWith('/')) throw ERROS_ARQUIVO.keyInvalida();
  if (key.includes('\\')) throw ERROS_ARQUIVO.keyInvalida();
  for (const segmento of key.split('/')) {
    if (segmento === '' || segmento === '.' || segmento === '..') throw ERROS_ARQUIVO.keyInvalida();
  }
  return key;
}

/** Corpo do POST /api/arquivos/inbox/preparar: espelha o buildAttachmentPath do Inbox. */
export class PrepararInboxDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  request_id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  mime!: string;

  @IsInt()
  @Min(0)
  @Max(500 * 1024 * 1024)
  size!: number;
}
