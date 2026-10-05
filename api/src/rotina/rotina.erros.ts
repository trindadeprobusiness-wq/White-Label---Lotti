import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Erro do Postgres que o Prisma embrulha em P2010 nas consultas $queryRaw/$executeRaw. */
export interface ErroPg {
  sqlstate: string;
  mensagem: string; // primeira linha, sem "ERROR: "/"ERRO: "
  detalhe: string | null;
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

export type OrigemErro = 'conflitos' | 'conclusao';

export interface OpcoesErro {
  /** De qual RPC veio o erro: separa o 22023 (contrato §0.4). */
  origem?: OrigemErro;
}

const ORIGEM = Symbol('origemErroRotina');

/** Marca de qual RPC o erro veio quando ele precisa atravessar o run (a tradução acontece fora dele). */
export function comOrigem(e: unknown, origem: OrigemErro): unknown {
  if (e && typeof e === 'object') (e as Record<symbol, unknown>)[ORIGEM] = origem;
  return e;
}

function origemDe(e: unknown): OrigemErro | undefined {
  return e && typeof e === 'object' ? ((e as Record<symbol, unknown>)[ORIGEM] as OrigemErro | undefined) : undefined;
}

const DADOS_INVALIDOS = new Set(['22P02', '22007', '22008', '22003', '22001', '23502', '23514']);
const MSG_INTERVALO = 'O horário de término precisa ser depois do início.';

export const ERROS = {
  semRotina: () => erroApi(403, 'routine_membership_required', 'Sua conta ainda não tem uma rotina ativa.'),
  naoEncontrado: (message = 'Atividade não encontrada.') => erroApi(404, 'nao_encontrado', message),
  concorrencia: () => erroApi(409, 'CONCURRENCY_CONFLICT', 'Esse compromisso mudou em outro lugar. Recarregue e tente de novo.'),
  conflito: (conflicts: unknown[]) => erroApi(409, 'CONFLICT', 'Existe outro compromisso nesse horário.', { conflicts }),
  googleNaoConectado: () => erroApi(409, 'google_nao_conectado', 'Google Agenda não conectado.'),
  nadaParaAtualizar: () => erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.'),
  googleNaoConfigurado: () => erroApi(503, 'google_nao_configurado', 'A integração com o Google Agenda não está configurada no servidor.'),
  iaNaoConfigurada: () => erroApi(503, 'ia_nao_configurada', 'A interpretação por IA não está configurada no servidor.'),
  syncPendente: () => erroApi(500, 'sync_pendente', 'A sincronização ficou pendente e será tentada novamente.'),
  conexaoFalhou: () => erroApi(500, 'conexao_falhou', 'Não foi possível concluir a conexão.'),
  comandoFalhou: () => erroApi(500, 'comando_falhou', 'Não consegui interpretar agora.'),
};

/** Responde com texto em português. Nunca repassa o texto do Postgres. Erro que não é do banco sobe como veio. */
export function traduzirErroBanco(e: unknown, op: OpcoesErro = {}): never {
  const pg = erroPg(e);
  if (!pg) throw e;
  const { sqlstate, mensagem, bruto } = pg;
  const origem = op.origem ?? origemDe(e);
  if (sqlstate === '42501') {
    if (mensagem === 'routine_client_outside_organization') {
      throw erroApi(422, 'cliente_fora_da_organizacao', 'Este cliente não pertence à sua organização.');
    }
    if (mensagem === 'routine_property_outside_organization') {
      throw erroApi(422, 'imovel_fora_da_organizacao', 'Este imóvel não pertence à sua organização.');
    }
    if (/^routine_\w+_outside_organization$/.test(mensagem)) {
      throw erroApi(422, 'vinculo_fora_da_organizacao', 'Um registro vinculado não pertence à sua organização.');
    }
    if (mensagem === 'routine_item_forbidden') throw erroApi(403, 'sem_permissao', 'Você não tem permissão para alterar esta atividade.');
    if (mensagem === 'acesso negado') throw erroApi(403, 'sem_permissao', 'Você não tem acesso à agenda desta pessoa.');
    throw erroApi(403, 'sem_permissao', 'Você não tem permissão para fazer esta alteração.');
  }
  if (sqlstate === '22023') {
    if (origem === 'conflitos') throw erroApi(400, 'intervalo_invalido', MSG_INTERVALO);
    if (origem === 'conclusao') throw erroApi(400, 'tipo_invalido', 'Tipo de atividade inválido.');
    throw erroApi(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.');
  }
  if (sqlstate === '23514' && /routine_events_check|end_at/.test(bruto)) throw erroApi(400, 'intervalo_invalido', MSG_INTERVALO);
  if (sqlstate === '23503') {
    throw erroApi(422, 'referencia_invalida', 'Um registro relacionado não existe mais. Recarregue a página e tente de novo.');
  }
  if (DADOS_INVALIDOS.has(sqlstate)) throw erroApi(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.');
  throw e;
}
