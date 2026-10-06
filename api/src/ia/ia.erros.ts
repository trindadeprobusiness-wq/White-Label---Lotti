import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Tradutor de erros do banco: cópia do M2 §0.4 (igual a contratos.erros.ts), como cada módulo faz.

/** Erro do Postgres que o Prisma embrulha em P2010 nas consultas $queryRaw/$executeRaw. */
export interface ErroPg {
  sqlstate: string;
  mensagem: string; // primeira linha, sem "ERROR: "/"ERRO: "
  detalhe: string | null; // DETAIL do RAISE
  bruto: string; // meta.message inteira: só para testar padrão, nunca para responder ou logar
}

export function erroPg(e: unknown): ErroPg | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2010') return null;
  const meta = (e.meta ?? {}) as { code?: unknown; message?: unknown };
  if (typeof meta.code !== 'string') return null;
  const bruto = typeof meta.message === 'string' ? meta.message : '';
  const linhas = bruto.split('\n');
  const mensagem = (linhas[0] ?? '').replace(/^[A-ZÀ-Ý]+:\s+/, '').trim();
  const linhaDetalhe = linhas.find((l) => /^(DETAIL|DETALHE):/.test(l));
  const detalhe = linhaDetalhe ? linhaDetalhe.replace(/^(DETAIL|DETALHE):\s*/, '').trim() || null : null;
  return { sqlstate: meta.code, mensagem, detalhe, bruto };
}

export function erroApi(status: number, codigo: string, message: string, extra: Record<string, unknown> = {}): HttpException {
  return new HttpException({ statusCode: status, codigo, message, ...extra }, status);
}

export interface OpcoesErro {
  forbidden?: string;
  semPermissao?: string;
  repetido?: string;
}

const DADOS_INVALIDOS = new Set(['22P02', '22007', '22008', '22003', '22001', '23502', '23514']);

/** Responde com texto em português. Nunca repassa o texto do Postgres. Erro que não é do banco sobe como veio. */
export function traduzirErroBanco(e: unknown, op: OpcoesErro = {}): never {
  const pg = erroPg(e);
  if (!pg) throw e;
  const { sqlstate, mensagem } = pg;
  if (sqlstate === 'P0001') {
    if (mensagem === 'forbidden') throw erroApi(403, 'forbidden', op.forbidden ?? 'Não foi possível identificar a sua conta. Entre novamente.');
    if (mensagem.startsWith('PLAN_LIMIT_REACHED:')) {
      const recurso = mensagem.slice('PLAN_LIMIT_REACHED:'.length);
      throw erroApi(402, 'PLAN_LIMIT_REACHED', 'Limite do plano atingido. Acesse Plano e Assinatura.', { recurso });
    }
  }
  if (sqlstate === '42501') {
    if (mensagem === 'Atendimento expirado.') throw erroApi(403, 'atendimento_expirado', 'Atendimento expirado.');
    throw erroApi(403, 'sem_permissao', op.semPermissao ?? 'Você não tem permissão para fazer esta alteração.');
  }
  if (sqlstate === '23503' || sqlstate === '23001') {
    throw erroApi(422, 'referencia_invalida', 'Um registro relacionado não existe mais. Recarregue a página e tente de novo.');
  }
  if (sqlstate === '23505') throw erroApi(409, 'registro_repetido', op.repetido ?? 'Já existe um registro igual.');
  if (DADOS_INVALIDOS.has(sqlstate)) throw erroApi(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.');
  throw e;
}

/** Só o código, para log: SQLSTATE, status HTTP ou nome do erro. Nunca o texto. */
export function codigoDe(e: unknown): string {
  if (e instanceof HttpException) return String(e.getStatus());
  const pg = erroPg(e);
  if (pg) return pg.sqlstate;
  const code = (e as { code?: unknown })?.code;
  if (typeof code === 'string') return code;
  return e instanceof Error ? e.name : 'erro';
}

export const SEM_CORRETOR = () => erroApi(403, 'corretor_nao_identificado', 'Não foi possível identificar o corretor.');
export const IA_INDISPONIVEL = () => erroApi(503, 'ia_indisponivel', 'A IA está indisponível no momento.');
