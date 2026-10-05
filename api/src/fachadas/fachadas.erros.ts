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
  /** Rota sem login (P1–P3): 42501 vira 404 para não revelar se a fachada existe (contrato §0.4). */
  publico?: boolean;
}

/** Erros fixos de serviço, sem passar pelo banco (contrato §0.4). */
export const ERROS = {
  naoEncontrado: () => erroApi(404, 'nao_encontrado', 'Fachada não encontrada.'),
  leadNaoEncontrado: () => erroApi(404, 'lead_nao_encontrado', 'Lead não encontrado.'),
  templateNaoEncontrado: () => erroApi(404, 'template_nao_encontrado', 'Template não encontrado.'),
  fachadaIndisponivel: () => erroApi(404, 'fachada_indisponivel', 'Esta placa não está mais disponível.'),
  nadaParaAtualizar: () => erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.'),
  idInvalido: () => erroApi(400, 'id_invalido', 'Identificador inválido.'),
  corretorNaoIdentificado: () => erroApi(403, 'corretor_nao_identificado', 'Não foi possível identificar o corretor.'),
  // F2: o RLS de INSERT em fachadas só confere corretor_id, NÃO o imovel_id. Sem esta checagem a conta A
  // poderia apontar a placa dela para o imóvel da conta B, e a rota pública P1 — que roda como dono do
  // banco, sem RLS — publicaria título, endereço, valor, descrição e fotos de B na landing de A.
  imovelIndisponivel: () => erroApi(422, 'referencia_invalida',
    'Este imóvel não está disponível para a sua conta. Recarregue a página e tente de novo.'),
};

const DADOS_INVALIDOS = new Set(['22P02', '22007', '22008', '22003', '22001', '23502', '23514']);
const PREFIXO_PLANO = 'PLAN_LIMIT_REACHED:';

/**
 * Responde com texto em português. Nunca repassa o texto do Postgres. Erro que não é do banco sobe como veio.
 * A ordem dos casos é a da tabela do contrato §0.4 e os testes a fixam.
 */
export function traduzirErroBanco(e: unknown, op: OpcoesErro = {}): never {
  const pg = erroPg(e);
  if (!pg) throw e;
  const { sqlstate, mensagem, bruto } = pg;
  if (sqlstate === 'P0001') {
    if (mensagem.startsWith(PREFIXO_PLANO)) {
      const recurso = mensagem.slice(PREFIXO_PLANO.length);
      throw erroApi(402, 'PLAN_LIMIT_REACHED', recurso === 'max_fachadas'
        ? 'Limite de Fachadas Inteligentes atingido. Acesse Plano e Assinatura para liberar mais fachadas.'
        : 'Limite do plano atingido. Acesse Plano e Assinatura.', { recurso });
    }
    if (mensagem === 'Fachada indisponível') throw ERROS.fachadaIndisponivel();
    if (mensagem === 'Dados de contato inválidos') throw erroApi(400, 'contato_invalido', 'Confira nome, telefone e e-mail e tente de novo.');
    if (mensagem === 'Telefone inválido') throw erroApi(400, 'telefone_invalido', 'Informe um telefone válido com DDD.');
    if (mensagem === 'Muitas tentativas. Aguarde alguns minutos.') {
      throw erroApi(429, 'muitas_tentativas', 'Muitas tentativas. Aguarde alguns minutos.');
    }
    // 'Configuração de limite inválida' e qualquer outro P0001 sobem como vieram: é bug do servidor, não do visitante.
    throw e;
  }
  // Antes do 23514 genérico: o gatilho tr_proteger_id_fachada protege o QR impresso na placa.
  if (sqlstate === '23514' && /identificador da fachada/.test(bruto)) {
    throw erroApi(409, 'id_imutavel',
      'O identificador da fachada é o QR Code impresso na placa e não pode mudar. Para um QR novo, exclua a fachada e crie outra.');
  }
  if (sqlstate === '42501') {
    if (mensagem === 'Atendimento expirado.') throw erroApi(403, 'atendimento_expirado', 'Atendimento expirado.');
    if (op.publico) throw ERROS.fachadaIndisponivel();
    throw erroApi(403, 'sem_permissao', 'Você não tem permissão para fazer esta alteração.');
  }
  // 23001: no Postgres 18 a FK com RESTRICT dá restrict_violation em vez de 23503.
  if (sqlstate === '23503' || sqlstate === '23001') {
    throw erroApi(422, 'referencia_invalida', 'Um registro relacionado não existe mais. Recarregue a página e tente de novo.');
  }
  if (DADOS_INVALIDOS.has(sqlstate)) throw erroApi(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.');
  throw e;
}
