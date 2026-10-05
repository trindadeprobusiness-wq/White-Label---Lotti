import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AsaasError, AsaasNaoConectado } from './asaas/asaas-http';

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
  entidade?: 'imovel' | 'cliente'; // liga o bloqueio por contrato (23503)
  forbidden?: string;
  semPermissao?: string;
  repetido?: string;
}

const ROTULO = { imovel: 'imóvel', cliente: 'cliente' } as const;
const DADOS_INVALIDOS = new Set(['22P02', '22007', '22008', '22003', '22001', '23502', '23514']);

/** Responde com texto em português. Nunca repassa o texto do Postgres. Erro que não é do banco sobe como veio. */
export function traduzirErroBanco(e: unknown, op: OpcoesErro = {}): never {
  const pg = erroPg(e);
  if (!pg) throw e;
  const { sqlstate, mensagem, detalhe, bruto } = pg;
  if (sqlstate === 'P0001') {
    if (mensagem === 'forbidden') throw erroApi(403, 'forbidden', op.forbidden ?? 'Não foi possível identificar a sua conta. Entre novamente.');
    if (mensagem === 'invalid_name') throw erroApi(422, 'invalid_name', 'Informe o nome do cliente.');
    if (mensagem === 'invalid_stage') throw erroApi(422, 'invalid_stage', 'A etapa do pipeline não existe mais. Recarregue a página e tente de novo.');
    if (mensagem === 'duplicate_client_phone') throw erroApi(409, 'duplicate_client_phone', 'Este telefone já é de outro cliente do CRM.', { detalhe });
    if (mensagem.startsWith('PLAN_LIMIT_REACHED:')) {
      const recurso = mensagem.slice('PLAN_LIMIT_REACHED:'.length);
      throw erroApi(402, 'PLAN_LIMIT_REACHED', recurso === 'max_imoveis'
        ? 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.'
        : 'Limite do plano atingido. Acesse Plano e Assinatura.', { recurso });
    }
  }
  if (sqlstate === '42501') {
    if (mensagem === 'Atendimento expirado.') throw erroApi(403, 'atendimento_expirado', 'Atendimento expirado.');
    throw erroApi(403, 'sem_permissao', op.semPermissao ?? 'Você não tem permissão para fazer esta alteração.');
  }
  // 23001: no Postgres 18 (o do Railway), a FK ON DELETE RESTRICT de contratos dá restrict_violation, e não 23503.
  if (sqlstate === '23503' || sqlstate === '23001') {
    if (op.entidade && /contratos/.test(bruto)) {
      throw erroApi(409, `${op.entidade}_com_contrato`, `Existem contratos vinculados a este ${ROTULO[op.entidade]}.`, { sqlstate: '23503' });
    }
    throw erroApi(422, 'referencia_invalida', 'Um registro relacionado não existe mais. Recarregue a página e tente de novo.');
  }
  if (sqlstate === '23505') throw erroApi(409, 'registro_repetido', op.repetido ?? 'Já existe um registro igual.');
  if (DADOS_INVALIDOS.has(sqlstate)) throw erroApi(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.');
  throw e;
}

// ---------------------------------------------------------------- extras do financeiro (contrato §0.4)

/** RAISE EXCEPTION de estornar_pagamento_fatura (P0001, sem ERRCODE). Texto repassado porque já é para o usuário. */
const ESTORNO: Record<string, { status: number; codigo: string }> = {
  'Fatura não encontrada ou sem permissão.': { status: 404, codigo: 'fatura_nao_encontrada' },
  'Só é possível desfazer o pagamento de faturas pagas.': { status: 409, codigo: 'fatura_nao_paga' },
  'O repasse ao proprietário desta fatura já foi executado — não é possível desfazer automaticamente.': { status: 409, codigo: 'repasse_ja_executado' },
};

export function traduzirErroEstorno(e: unknown): never {
  const pg = erroPg(e);
  if (pg?.sqlstate === 'P0001' && ESTORNO[pg.mensagem]) {
    const { status, codigo } = ESTORNO[pg.mensagem];
    throw erroApi(status, codigo, pg.mensagem);
  }
  traduzirErroBanco(e);
}

export function traduzirErroAsaas(e: unknown): never {
  if (e instanceof AsaasNaoConectado) throw erroApi(409, 'ASAAS_NAO_CONECTADO', e.message, { nao_conectado: true });
  if (e instanceof AsaasError) {
    throw erroApi(e.status === 401 ? 502 : 400, 'asaas_recusou', e.descricao ?? 'O Asaas recusou a operação.');
  }
  throw e;
}

/** A operação já mudou algo no Asaas e a gravação local falhou (D4). */
export function erroGravacaoPosAsaas() {
  return erroApi(500, 'gravacao_pos_asaas',
    'A operação foi feita no Asaas, mas não consegui registrar aqui. Atualize a página e confira antes de tentar de novo.');
}

/** Linha de to_jsonb: chaves e tipos iguais aos que o PostgREST entrega hoje. */
export type Linha = Record<string, unknown>;

export const MSG_SEM_CORRETOR = 'Não foi possível identificar o corretor.';

/** get_corretor_id() da sessão (TenantDb). NULL → 403 corretor_nao_identificado. */
export async function exigirCorretor(tx: Prisma.TransactionClient, message = MSG_SEM_CORRETOR): Promise<string> {
  const linhas = await tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`select public.get_corretor_id()::text as id`);
  const id = linhas[0]?.id;
  if (!id) throw erroApi(403, 'corretor_nao_identificado', message);
  return id;
}
