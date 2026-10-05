import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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
  /** Texto para o P0001 que não está na tabela (nunca o texto do Postgres). */
  padrao?: string;
}

export const DADOS_INVALIDOS = new Set(['22P02', '22007', '22008', '22003', '22001', '23502', '23514']);
/** Função ou tabela de onboarding ainda não aplicada: o front mantém o silêncio de hoje. */
const INDISPONIVEL = new Set(['42883', '42P01', '42703']);

const MSG_SEM_CONTA = 'Não foi possível identificar a sua conta. Entre novamente.';
const MSG_SEM_ONBOARDING = 'Seu onboarding ainda não foi criado. Recarregue a página.';

/** [mensagem exata do RAISE, HTTP, codigo, texto para o usuário] */
const P0001: Array<[string, number, string, string]> = [
  ['perfil de onboarding não encontrado', 404, 'perfil_nao_encontrado', MSG_SEM_ONBOARDING],
  ['onboarding não encontrado', 404, 'onboarding_nao_encontrado', MSG_SEM_ONBOARDING],
  ['organização indisponível', 403, 'corretor_nao_identificado', MSG_SEM_CONTA],
  ['título, cidade e valor são obrigatórios', 422, 'dados_incompletos', 'Informe título, cidade e valor do imóvel.'],
  ['nome e telefone ou e-mail são obrigatórios', 422, 'dados_incompletos', 'Informe o nome e um telefone ou e-mail.'],
  ['cliente inválido', 422, 'cliente_invalido', 'Este cliente não existe mais. Recarregue a página.'],
  ['imóvel inválido', 422, 'imovel_invalido', 'Este imóvel não existe mais. Recarregue a página.'],
  ['pipeline não configurado', 422, 'pipeline_nao_configurado', 'Seu funil ainda não tem etapas. Recarregue a página e tente de novo.'],
  ['responsável inválido', 422, 'responsavel_invalido', 'Escolha um responsável da sua equipe.'],
  ['ação de onboarding inválida', 400, 'acao_invalida', 'Esta ação de onboarding não existe.'],
  ['evento de onboarding inválido', 400, 'evento_invalido', 'Este evento de onboarding não existe.'],
  ['somente gestores podem convidar', 403, 'sem_permissao_convite', 'Somente gestores da organização podem convidar.'],
  ['e-mail inválido', 422, 'email_invalido', 'Informe um e-mail válido.'],
  ['papel inválido', 422, 'papel_invalido', 'Escolha uma função válida para o convite.'],
  ['convite inválido ou expirado', 404, 'convite_invalido', 'Este convite não é válido ou já expirou.'],
  ['este convite pertence a outro e-mail', 403, 'convite_de_outro_email', 'Este convite foi enviado para outro e-mail.'],
];

/** Responde com texto em português. Nunca repassa o texto do Postgres. Erro que não é do banco sobe como veio. */
export function traduzirErroAssinatura(e: unknown, op: OpcoesErro = {}): never {
  const pg = erroPg(e);
  if (!pg) throw e;
  const { sqlstate, mensagem } = pg;
  if (sqlstate === 'P0001') {
    const conhecido = P0001.find(([texto]) => texto === mensagem);
    if (conhecido) throw erroApi(conhecido[1], conhecido[2], conhecido[3]);
    if (mensagem.startsWith('PLAN_LIMIT_REACHED:')) {
      const recurso = mensagem.slice('PLAN_LIMIT_REACHED:'.length);
      throw erroApi(402, 'PLAN_LIMIT_REACHED', recurso === 'max_imoveis'
        ? 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.'
        : 'Limite do plano atingido. Acesse Plano e Assinatura.', { recurso });
    }
    if (mensagem === 'forbidden') throw erroApi(403, 'forbidden', MSG_SEM_CONTA);
    throw erroApi(422, 'regra_do_banco', op.padrao ?? 'Não foi possível concluir esta ação.');
  }
  if (sqlstate === '42501') throw erroApi(403, 'sem_permissao', 'Você não tem permissão para fazer esta alteração.');
  if (INDISPONIVEL.has(sqlstate)) throw erroApi(503, 'onboarding_indisponivel', 'Onboarding temporariamente indisponível.');
  if (sqlstate === '23503' || sqlstate === '23001') {
    throw erroApi(422, 'referencia_invalida', 'Um registro relacionado não existe mais. Recarregue a página e tente de novo.');
  }
  if (sqlstate === '23505') throw erroApi(409, 'registro_repetido', 'Já existe um registro igual.');
  if (DADOS_INVALIDOS.has(sqlstate)) throw erroApi(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.');
  throw e;
}
