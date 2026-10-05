import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MENSAGENS_RPC, normalizar, regraRpc, traduzirErroBanco } from './parceiros.erros';

function erroBanco(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 'teste', meta: { code, message } });
}

function traduzido(e: unknown, op?: Parameters<typeof traduzirErroBanco>[1]) {
  try {
    traduzirErroBanco(e, op);
  } catch (t) {
    if (t instanceof HttpException) return { status: t.getStatus(), ...(t.getResponse() as Record<string, unknown>) };
    return { lancou: t };
  }
  return null;
}

/** As mensagens chegam como o Prisma entrega: "ERROR: <texto>" e DETAIL numa linha nova. */
const pg = (code: string, texto: string, detalhe?: string) => erroBanco(code, `ERROR: ${texto}${detalhe ? `\nDETAIL: ${detalhe}` : ''}`);

describe('parceiros.erros: 42501 e 22023', () => {
  it('acesso negado vira 403 sem_permissao com e sem origem portal', () => {
    for (const op of [undefined, { origem: 'portal' as const }]) {
      expect(traduzido(pg('42501', 'acesso negado'), op)).toMatchObject({ status: 403, codigo: 'sem_permissao' });
    }
  });

  it('autenticacao necessaria vira 403 sessao_invalida', () => {
    expect(traduzido(pg('42501', 'autenticacao necessaria'))).toMatchObject({
      status: 403, codigo: 'sessao_invalida', message: 'Não foi possível identificar a sua conta. Entre novamente.',
    });
  });

  it('parceiro nao encontrado só vira parceiro_nao_vinculado no portal', () => {
    expect(traduzido(pg('42501', 'parceiro nao encontrado'), { origem: 'portal' })).toMatchObject({
      status: 403, codigo: 'parceiro_nao_vinculado',
    });
    expect(traduzido(pg('42501', 'email divergente'), { origem: 'portal' })).toMatchObject({ codigo: 'parceiro_nao_vinculado' });
    expect(traduzido(pg('42501', 'parceiro nao encontrado'))).toMatchObject({ status: 403, codigo: 'sem_permissao' });
  });

  it('modo de atendimento vira 409', () => {
    expect(traduzido(pg('42501', 'A conta precisa estar ativa para iniciar atendimento.'))).toMatchObject({
      status: 409, codigo: 'conta_inativa',
    });
    expect(traduzido(pg('42501', 'Contas administrativas nao podem ser abertas em modo de atendimento.'))).toMatchObject({
      status: 409, codigo: 'conta_administrativa',
    });
  });

  it('42501 desconhecido cai em sem_permissao', () => {
    expect(traduzido(pg('42501', 'qualquer outra coisa'))).toMatchObject({ status: 403, codigo: 'sem_permissao' });
  });

  it('22023 do portal difere do 22023 geral', () => {
    expect(traduzido(pg('22023', 'chave pix invalida'), { origem: 'portal' })).toMatchObject({
      status: 422, codigo: 'dados_de_repasse_invalidos', message: 'Confira o documento e a chave PIX do mesmo titular.',
    });
    expect(traduzido(pg('22023', 'chave pix invalida'))).toMatchObject({ status: 400, codigo: 'dados_invalidos' });
  });
});

describe('parceiros.erros: allowlist P0001', () => {
  it('toda entrada de MENSAGENS_RPC é alcançada pelo seu próprio texto', () => {
    for (const regra of MENSAGENS_RPC) {
      const texto = regra.contem ? `${regra.prefixo}LOTE-2026-01 ${regra.contem}` : `${regra.prefixo}: detalhe %`;
      const r = traduzido(pg('P0001', texto));
      expect(r).toMatchObject({ status: 422, codigo: regra.codigo, message: regra.message });
      expect(regraRpc(texto)).toEqual(regra);
    }
  });

  it('as mensagens reais do banco (acentuadas) casam com a allowlist', () => {
    const reais: Array<[string, string]> = [
      ['informe uma justificativa com ao menos 10 caracteres', 'justificativa_curta'],
      ['lote não encontrado', 'lote_nao_encontrado'],
      ['lote já pago não pode ser cancelado; estorne as comissões', 'lote_pago'],
      ['lote exportado não pode ser marcado como pago', 'lote_nao_pagavel'],
      ['transição inválida: pendente → paga', 'transicao_invalida'],
      ['base de cálculo inválida: xpto', 'base_invalida'],
      ['a nova vigência precisa começar depois de 01/01/2026 (início da vigência atual)', 'vigencia_invalida'],
      ['só é possível estornar receita confirmada (atual: estornado)', 'receita_nao_confirmada'],
      ['não é possível registrar receita com data futura', 'data_futura'],
      ['a seleção tem 3 comissões, mas só 1 estão aprovadas para este parceiro', 'selecao_divergente'],
      ['período inválido: início depois do fim', 'periodo_invalido'],
      ['configuração desconhecida: xpto', 'config_desconhecida'],
      ['comissão não encontrada', 'comissao_nao_encontrada'],
      ['você não pode alterar o status da própria conta', 'conta_propria'],
      ['o usuário já possui esse papel', 'papel_repetido'],
      ['organização não encontrada', 'organizacao_nao_encontrada'],
      ['identificador do link inválido', 'slug_invalido'],
      ['nome ou e-mail inválido', 'parceiro_invalido'],
      ['informe a referência ou o comprovante do pagamento', 'referencia_ausente'],
      ['apenas lote em rascunho pode ser exportado', 'lote_nao_exportavel'],
      ['o valor precisa ser maior que zero', 'valor_invalido'],
      ['status inválido: xpto', 'status_invalido'],
      ['percentual inválido', 'percentual_invalido'],
      ['regra de renovação inválida', 'renovacao_invalida'],
      ['nenhuma comissão elegível para os parceiros selecionados', 'sem_comissao_elegivel'],
      ['nenhuma comissão aprovada deste parceiro na seleção', 'sem_comissao_aprovada'],
      ['selecione ao menos um parceiro', 'selecao_vazia'],
      ['papel ativo não encontrado', 'papel_nao_encontrado'],
      ['papel inválido: suporte', 'papel_invalido'],
      ['corretor não encontrado', 'conta_nao_encontrada'],
      ['conta não encontrada', 'conta_nao_encontrada'],
      ['evento de receita não encontrado', 'receita_nao_encontrada'],
      ['a plataforma precisa manter ao menos um super admin', 'ultimo_super_admin'],
      ['você não pode revogar o próprio papel de super admin', 'papel_proprio'],
    ];
    for (const [texto, codigo] of reais) expect(traduzido(pg('P0001', texto))).toMatchObject({ status: 422, codigo });
  });

  it('P0001 desconhecido vira regra_do_backoffice e não repassa o texto do Postgres', () => {
    const cru = 'mensagem que a API nunca viu';
    const r = traduzido(pg('P0001', cru)) as Record<string, unknown>;
    expect(r).toMatchObject({
      status: 422, codigo: 'regra_do_backoffice',
      message: 'Não foi possível concluir a operação. Confira os dados e tente de novo.',
    });
    expect(JSON.stringify(r)).not.toContain(cru);
  });

  it('normalizar tira acento e caixa', () => {
    expect(normalizar('Transição INVÁLIDA')).toBe('transicao invalida');
  });
});

describe('parceiros.erros: uniques e demais SQLSTATE', () => {
  const casos: Array<[string, string, string, number, string]> = [
    ['23505', 'duplicate key value violates unique constraint "uq_parceiros_email"', '', 409, 'parceiro_repetido'],
    ['23505', 'duplicate key value violates unique constraint "uq_parceiro_links_slug"', '', 409, 'link_repetido'],
    ['23505', 'duplicate key value violates unique constraint "uq_parceiro_link_principal"', '', 409, 'link_repetido'],
    ['23505', 'duplicate key value violates unique constraint "uq_percentual_vigente"', '', 409, 'percentual_repetido'],
    ['23505', 'duplicate key value violates unique constraint "uq_atribuicao_visitante"', '', 409, 'atribuicao_repetida'],
    ['23505', 'duplicate key value violates unique constraint "uq_atribuicao_user"', '', 409, 'atribuicao_repetida'],
    ['23505', 'duplicate key value violates unique constraint "uq_atribuicao_corretor"', '', 409, 'atribuicao_repetida'],
    ['23505', 'duplicate key value violates unique constraint "outra_coisa"', '', 409, 'registro_repetido'],
    ['23503', 'insert or update on table violates foreign key constraint', '', 422, 'referencia_invalida'],
    ['23001', 'restrict violation', '', 422, 'referencia_invalida'],
    ['42P01', 'relation "public.parceiros" does not exist', '', 503, 'backoffice_nao_instalado'],
    ['42883', 'function public.admin_listar_parceiros(...) does not exist', '', 503, 'backoffice_nao_instalado'],
    ['22P02', 'invalid input syntax for type uuid', '', 400, 'dados_invalidos'],
    ['23502', 'null value in column violates not-null constraint', '', 400, 'dados_invalidos'],
    ['23514', 'check constraint violated', '', 400, 'dados_invalidos'],
  ];

  it.each(casos)('%s %s', (code, message, _d, status, codigo) => {
    expect(traduzido(pg(code, message))).toMatchObject({ status, codigo });
  });

  it('erro que não é do banco sobe como veio', () => {
    const original = new Error('rede caiu');
    expect(traduzido(original)).toEqual({ lancou: original });
  });

  it('HttpException lançada dentro do run passa intacta', () => {
    const http = new HttpException({ statusCode: 404, codigo: 'nao_encontrado', message: 'Parceiro não encontrado.' }, 404);
    let relancado: unknown;
    try {
      traduzirErroBanco(http);
    } catch (e) {
      relancado = e;
    }
    expect(relancado).toBe(http);
  });
});
