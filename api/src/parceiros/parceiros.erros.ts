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

export type OrigemErro = 'portal' | 'backoffice' | 'publico';

export interface OpcoesErro {
  /** De onde veio o erro: separa o 22023 do portal (contrato §0.4). */
  origem?: OrigemErro;
}

/** Regra da allowlist: a mensagem do RAISE casa por prefixo (normalizado) e, quando precisa, por um trecho. */
export interface RegraRpc {
  prefixo: string;
  /** Trecho obrigatório depois do prefixo, para mensagens que interpolam valor no meio. */
  contem?: string;
  codigo: string;
  message: string;
}

/**
 * Lista FECHADA das regras do backoffice.
 *
 * As RPCs `admin_*` levantam RAISE sem ERRCODE (P0001) com texto em português para o operador, e hoje
 * esse texto chega verbatim ao toast do painel. Para preservar o comportamento sem nunca repassar texto
 * do Postgres que a API não conhece, a mensagem só é devolvida quando casa com uma entrada daqui.
 * Qualquer outro P0001 vira 422 `regra_do_backoffice` com texto genérico.
 *
 * A ordem importa: a primeira regra que casar vence (ex.: `lote nao encontrado` antes de `lote …`).
 */
export const MENSAGENS_RPC: readonly RegraRpc[] = [
  { prefixo: 'acesso negado', codigo: 'sem_permissao', message: 'Você não tem permissão para esta ação.' },
  {
    prefixo: 'informe uma justificativa com ao menos 10 caracteres',
    codigo: 'justificativa_curta',
    message: 'Informe uma justificativa com ao menos 10 caracteres.',
  },
  {
    prefixo: 'voce nao pode alterar o status da propria conta',
    codigo: 'conta_propria',
    message: 'Você não pode alterar o status da própria conta.',
  },
  {
    prefixo: 'voce nao pode revogar o proprio papel de super admin',
    codigo: 'papel_proprio',
    message: 'Você não pode revogar o próprio papel de super admin.',
  },
  {
    prefixo: 'a plataforma precisa manter ao menos um super admin',
    codigo: 'ultimo_super_admin',
    message: 'A plataforma precisa manter ao menos um super admin.',
  },
  { prefixo: 'o usuario ja possui esse papel', codigo: 'papel_repetido', message: 'O usuário já possui esse papel.' },
  { prefixo: 'papel ativo nao encontrado', codigo: 'papel_nao_encontrado', message: 'Papel ativo não encontrado.' },
  { prefixo: 'papel invalido', codigo: 'papel_invalido', message: 'Papel inválido.' },
  { prefixo: 'usuario nao encontrado', codigo: 'conta_nao_encontrada', message: 'Conta não encontrada.' },
  { prefixo: 'conta nao encontrada', codigo: 'conta_nao_encontrada', message: 'Conta não encontrada.' },
  { prefixo: 'corretor nao encontrado', codigo: 'conta_nao_encontrada', message: 'Conta não encontrada.' },
  { prefixo: 'organizacao nao encontrada', codigo: 'organizacao_nao_encontrada', message: 'Organização não encontrada.' },
  { prefixo: 'comissao nao encontrada', codigo: 'comissao_nao_encontrada', message: 'Comissão não encontrada.' },
  { prefixo: 'evento de receita nao encontrado', codigo: 'receita_nao_encontrada', message: 'Evento de receita não encontrado.' },
  { prefixo: 'lote nao encontrado', codigo: 'lote_nao_encontrado', message: 'Lote não encontrado.' },
  {
    prefixo: 'lote ja pago nao pode ser cancelado',
    codigo: 'lote_pago',
    message: 'Lote já pago não pode ser cancelado; estorne as comissões.',
  },
  { prefixo: 'apenas lote em rascunho pode ser exportado', codigo: 'lote_nao_exportavel', message: 'Apenas lote em rascunho pode ser exportado.' },
  {
    prefixo: 'lote ',
    contem: 'nao pode ser marcado como pago',
    codigo: 'lote_nao_pagavel',
    message: 'Este lote não pode ser marcado como pago no status atual.',
  },
  { prefixo: 'transicao invalida', codigo: 'transicao_invalida', message: 'Transição de status não permitida para esta comissão.' },
  { prefixo: 'status invalido', codigo: 'status_invalido', message: 'Status inválido.' },
  { prefixo: 'base de calculo invalida', codigo: 'base_invalida', message: 'Base de cálculo inválida.' },
  { prefixo: 'percentual invalido', codigo: 'percentual_invalido', message: 'Percentual inválido.' },
  { prefixo: 'regra de renovacao invalida', codigo: 'renovacao_invalida', message: 'Regra de renovação inválida.' },
  { prefixo: 'identificador do link invalido', codigo: 'slug_invalido', message: 'Identificador do link inválido.' },
  { prefixo: 'nome ou e-mail invalido', codigo: 'parceiro_invalido', message: 'Confira o nome e o e-mail do parceiro.' },
  {
    prefixo: 'a nova vigencia precisa comecar depois de',
    codigo: 'vigencia_invalida',
    message: 'A nova vigência precisa começar depois do início da vigência atual.',
  },
  { prefixo: 'selecione ao menos um parceiro', codigo: 'selecao_vazia', message: 'Selecione ao menos um parceiro.' },
  { prefixo: 'selecione ao menos uma comissao', codigo: 'selecao_vazia', message: 'Selecione ao menos uma comissão.' },
  {
    prefixo: 'nenhuma comissao elegivel para os parceiros selecionados',
    codigo: 'sem_comissao_elegivel',
    message: 'Nenhuma comissão elegível para os parceiros selecionados.',
  },
  {
    prefixo: 'nenhuma comissao aprovada deste parceiro na selecao',
    codigo: 'sem_comissao_aprovada',
    message: 'Nenhuma comissão aprovada deste parceiro na seleção.',
  },
  {
    prefixo: 'a selecao tem',
    codigo: 'selecao_divergente',
    message: 'A seleção mudou. Recarregue a página e confira as comissões aprovadas.',
  },
  {
    prefixo: 'informe a referencia ou o comprovante do pagamento',
    codigo: 'referencia_ausente',
    message: 'Informe a referência ou o comprovante do pagamento.',
  },
  {
    prefixo: 'so e possivel estornar receita confirmada',
    codigo: 'receita_nao_confirmada',
    message: 'Só é possível estornar receita confirmada.',
  },
  {
    prefixo: 'nao e possivel registrar receita com data futura',
    codigo: 'data_futura',
    message: 'Não é possível registrar receita com data futura.',
  },
  { prefixo: 'o valor precisa ser maior que zero', codigo: 'valor_invalido', message: 'O valor precisa ser maior que zero.' },
  { prefixo: 'periodo invalido', codigo: 'periodo_invalido', message: 'Período inválido: o início está depois do fim.' },
  { prefixo: 'configuracao desconhecida', codigo: 'config_desconhecida', message: 'Configuração desconhecida.' },
];

/** Minúsculas e sem acento: as mensagens do banco vêm acentuadas e interpolam valores. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function regraRpc(mensagem: string): RegraRpc | null {
  const alvo = normalizar(mensagem);
  return MENSAGENS_RPC.find((r) => alvo.startsWith(r.prefixo) && (!r.contem || alvo.includes(r.contem))) ?? null;
}

export const ERROS = {
  nadaParaAtualizar: () => erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.'),
  acaoInvalida: () => erroApi(400, 'acao_invalida', 'Ação inválida.'),
  idInvalido: () => erroApi(400, 'id_invalido', 'Identificador inválido.'),
  chaveInvalida: () => erroApi(400, 'chave_invalida', 'Chave de configuração inválida.'),
  eventoInvalido: () => erroApi(400, 'evento_invalido', 'Evento inválido.'),
  consentimentoAusente: () => erroApi(400, 'consentimento_ausente', 'Confirme o uso dos dados para contato.'),
  contatoInvalido: () => erroApi(400, 'contato_invalido', 'Confira nome, WhatsApp e e-mail.'),
  respostasInvalidas: (message: string) => erroApi(400, 'respostas_invalidas', message),
  dadosInvalidos: () => erroApi(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.'),
  origemNaoPermitida: () => erroApi(403, 'origem_nao_permitida', 'Origem não permitida.'),
  semPermissao: () => erroApi(403, 'sem_permissao', 'Você não tem permissão para esta ação.'),
  parceiroNaoVinculado: () => erroApi(403, 'parceiro_nao_vinculado', 'Este e-mail ainda não está vinculado a um parceiro ativo.'),
  naoEncontrado: () => erroApi(404, 'nao_encontrado', 'Parceiro não encontrado.'),
  diagnosticoNaoEncontrado: () => erroApi(404, 'diagnostico_nao_encontrado', 'Diagnóstico não encontrado.'),
  configDesconhecida: () => erroApi(404, 'config_desconhecida', 'Configuração desconhecida.'),
  parceiroInativo: () => erroApi(409, 'parceiro_inativo', 'Ative o parceiro antes de enviar o convite.'),
  conviteJaAceito: () => erroApi(409, 'convite_ja_aceito', 'Este parceiro já aceitou o convite.'),
  muitasTentativas: () => erroApi(429, 'muitas_tentativas', 'Muitas tentativas. Aguarde alguns minutos.'),
  corpoGrande: () => erroApi(413, 'corpo_grande', 'Requisição muito grande.'),
  provedorDeEmailNaoConfigurado: () => erroApi(
    503, 'provedor_de_email_nao_configurado', 'O envio de convites por e-mail ainda não está configurado no servidor.',
  ),
  diagnosticoNaoConfigurado: () => erroApi(
    503, 'diagnostico_nao_configurado', 'A captura do diagnóstico comercial não está configurada no servidor.',
  ),
  backofficeNaoInstalado: () => erroApi(
    503, 'backoffice_nao_instalado', 'As migrations do back office ainda não foram aplicadas neste banco.',
  ),
};

const DADOS_INVALIDOS = new Set(['22P02', '22007', '22008', '22003', '22001', '23502', '23514']);

const UNIQUES: ReadonlyArray<{ padrao: RegExp; codigo: string; message: string }> = [
  { padrao: /uq_parceiros_email/, codigo: 'parceiro_repetido', message: 'Já existe parceiro com este e-mail.' },
  { padrao: /uq_parceiro_links_slug|uq_parceiro_link_principal/, codigo: 'link_repetido', message: 'Este identificador de link já está em uso.' },
  { padrao: /uq_percentual_vigente/, codigo: 'percentual_repetido', message: 'Já existe uma vigência aberta para este parceiro.' },
  {
    padrao: /uq_atribuicao_visitante|uq_atribuicao_user|uq_atribuicao_corretor/,
    codigo: 'atribuicao_repetida',
    message: 'Esta origem já foi registrada.',
  },
];

/**
 * Responde com texto em português. Nunca repassa o texto do Postgres: as regras conhecidas saem da
 * allowlist MENSAGENS_RPC, o resto vira texto genérico. Erro que não é do banco sobe como veio.
 *
 * Chamado sempre FORA do run: dentro dele a transação já está abortada.
 */
export function traduzirErroBanco(e: unknown, op: OpcoesErro = {}): never {
  const pg = erroPg(e);
  if (!pg) throw e;
  const { sqlstate, mensagem, bruto } = pg;
  const alvo = normalizar(mensagem);
  if (sqlstate === '42501') {
    if (alvo.startsWith('acesso negado')) throw ERROS.semPermissao();
    if (alvo.startsWith('autenticacao necessaria')) {
      throw erroApi(403, 'sessao_invalida', 'Não foi possível identificar a sua conta. Entre novamente.');
    }
    if (op.origem === 'portal' && (alvo.startsWith('parceiro nao encontrado') || alvo.startsWith('email divergente'))) {
      throw ERROS.parceiroNaoVinculado();
    }
    if (alvo.startsWith('a conta precisa estar ativa para iniciar atendimento')) {
      throw erroApi(409, 'conta_inativa', 'A conta precisa estar ativa para iniciar o atendimento.');
    }
    if (alvo.startsWith('contas administrativas nao podem ser abertas em modo de atendimento')) {
      throw erroApi(409, 'conta_administrativa', 'Contas administrativas não podem ser abertas em modo de atendimento.');
    }
    throw ERROS.semPermissao();
  }
  if (sqlstate === '22023') {
    if (op.origem === 'portal') throw erroApi(422, 'dados_de_repasse_invalidos', 'Confira o documento e a chave PIX do mesmo titular.');
    throw ERROS.dadosInvalidos();
  }
  if (sqlstate === 'P0001') {
    const regra = regraRpc(mensagem);
    if (regra) throw erroApi(422, regra.codigo, regra.message);
    throw erroApi(422, 'regra_do_backoffice', 'Não foi possível concluir a operação. Confira os dados e tente de novo.');
  }
  if (sqlstate === '23505') {
    const unico = UNIQUES.find((u) => u.padrao.test(bruto));
    if (unico) throw erroApi(409, unico.codigo, unico.message);
    throw erroApi(409, 'registro_repetido', 'Já existe um registro igual.');
  }
  if (sqlstate === '23503' || sqlstate === '23001') {
    throw erroApi(422, 'referencia_invalida', 'Um registro relacionado não existe mais. Recarregue a página e tente de novo.');
  }
  if (sqlstate === '42P01' || sqlstate === '42883') throw ERROS.backofficeNaoInstalado();
  if (DADOS_INVALIDOS.has(sqlstate)) throw ERROS.dadosInvalidos();
  throw e;
}
