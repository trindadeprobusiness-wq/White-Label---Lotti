import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { erroPg, ERROS, traduzirErroBanco } from './fachadas.erros';

/** Como o harness entrega: severidade em inglês (lc_messages = C) ou em português, conforme o servidor. */
const pg = (code: string, mensagem: string, severidade = 'ERROR', detalhe?: string) =>
  new Prisma.PrismaClientKnownRequestError('x', {
    code: 'P2010',
    clientVersion: 'teste',
    meta: { code, message: `${severidade}: ${mensagem}${detalhe ? `\nDETAIL: ${detalhe}` : ''}` },
  });

interface Traduzido { status: number; corpo: Record<string, unknown>; original?: unknown }

function traduzir(e: unknown, op: Parameters<typeof traduzirErroBanco>[1] = {}): Traduzido {
  try {
    traduzirErroBanco(e, op);
  } catch (erro) {
    if (erro instanceof HttpException) return { status: erro.getStatus(), corpo: erro.getResponse() as Record<string, unknown> };
    return { status: 0, corpo: {}, original: erro };
  }
  throw new Error('traduzirErroBanco deveria sempre lançar');
}

describe('erroPg', () => {
  it('separa sqlstate, primeira linha sem a severidade e o DETAIL', () => {
    const r = erroPg(pg('23502', 'null value in column "nome"', 'ERROR', 'Failing row contains (...)'));
    expect(r).toEqual({
      sqlstate: '23502',
      mensagem: 'null value in column "nome"',
      detalhe: 'Failing row contains (...)',
      bruto: 'ERROR: null value in column "nome"\nDETAIL: Failing row contains (...)',
    });
  });

  it('aceita a severidade em português (ERRO:) e o DETALHE:', () => {
    const e = new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2010', clientVersion: 'teste', meta: { code: 'P0001', message: 'ERRO: Telefone inválido\nDETALHE: x' },
    });
    expect(erroPg(e)).toMatchObject({ sqlstate: 'P0001', mensagem: 'Telefone inválido', detalhe: 'x' });
  });

  it('devolve null para erro que não é P2010 do banco', () => {
    expect(erroPg(new Error('qualquer'))).toBeNull();
    expect(erroPg(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 't' }))).toBeNull();
  });
});

describe('traduzirErroBanco: uma linha por caso da tabela §0.4', () => {
  it('P0001 PLAN_LIMIT_REACHED:max_fachadas vira 402 com texto próprio e recurso', () => {
    expect(traduzir(pg('P0001', 'PLAN_LIMIT_REACHED:max_fachadas'))).toEqual({
      status: 402,
      corpo: {
        statusCode: 402,
        codigo: 'PLAN_LIMIT_REACHED',
        message: 'Limite de Fachadas Inteligentes atingido. Acesse Plano e Assinatura para liberar mais fachadas.',
        recurso: 'max_fachadas',
      },
    });
  });

  it('PLAN_LIMIT_REACHED de outro recurso usa o texto genérico', () => {
    const r = traduzir(pg('P0001', 'PLAN_LIMIT_REACHED:max_imoveis'));
    expect(r.status).toBe(402);
    expect(r.corpo).toMatchObject({ message: 'Limite do plano atingido. Acesse Plano e Assinatura.', recurso: 'max_imoveis' });
  });

  it('Fachada indisponível vira 404 fachada_indisponivel', () => {
    expect(traduzir(pg('P0001', 'Fachada indisponível'))).toMatchObject({
      status: 404, corpo: { codigo: 'fachada_indisponivel', message: 'Esta placa não está mais disponível.' },
    });
  });

  it('Dados de contato inválidos vira 400 contato_invalido', () => {
    expect(traduzir(pg('P0001', 'Dados de contato inválidos'))).toMatchObject({
      status: 400, corpo: { codigo: 'contato_invalido', message: 'Confira nome, telefone e e-mail e tente de novo.' },
    });
  });

  it('Telefone inválido vira 400 telefone_invalido', () => {
    expect(traduzir(pg('P0001', 'Telefone inválido'))).toMatchObject({
      status: 400, corpo: { codigo: 'telefone_invalido', message: 'Informe um telefone válido com DDD.' },
    });
  });

  it('Muitas tentativas vira 429 muitas_tentativas', () => {
    expect(traduzir(pg('P0001', 'Muitas tentativas. Aguarde alguns minutos.'))).toMatchObject({
      status: 429, corpo: { codigo: 'muitas_tentativas', message: 'Muitas tentativas. Aguarde alguns minutos.' },
    });
  });

  it('Configuração de limite inválida sobe como veio: é bug do servidor, não do visitante', () => {
    const e = pg('P0001', 'Configuração de limite inválida');
    expect(traduzir(e)).toEqual({ status: 0, corpo: {}, original: e });
  });

  it('23514 do gatilho do id vira 409 id_imutavel, ANTES do 23514 genérico', () => {
    const e = pg('23514', 'O identificador da fachada é o QR Code impresso na placa e não pode mudar. Para um QR novo, exclua a fachada e crie outra.');
    const r = traduzir(e);
    expect(r.status).toBe(409);
    expect(r.corpo.codigo).toBe('id_imutavel');
    expect(r.corpo.message).toContain('QR Code impresso na placa');
  });

  it('23514 de qualquer outro check cai em 400 dados_invalidos', () => {
    expect(traduzir(pg('23514', 'new row violates check constraint "fachadas_tipo_negocio_check"'))).toMatchObject({
      status: 400, corpo: { codigo: 'dados_invalidos' },
    });
  });

  it('42501 Atendimento expirado. vem ANTES dos outros 42501, nos dois modos', () => {
    for (const op of [{}, { publico: true }]) {
      expect(traduzir(pg('42501', 'Atendimento expirado.'), op)).toMatchObject({
        status: 403, corpo: { codigo: 'atendimento_expirado', message: 'Atendimento expirado.' },
      });
    }
  });

  it('42501 na rota pública vira 404 e não revela se a fachada existe', () => {
    expect(traduzir(pg('42501', 'new row violates row-level security policy'), { publico: true })).toMatchObject({
      status: 404, corpo: { codigo: 'fachada_indisponivel' },
    });
  });

  it('42501 na rota autenticada vira 403 sem_permissao', () => {
    expect(traduzir(pg('42501', 'new row violates row-level security policy'))).toMatchObject({
      status: 403, corpo: { codigo: 'sem_permissao', message: 'Você não tem permissão para fazer esta alteração.' },
    });
  });

  it('23503 e 23001 viram 422 referencia_invalida', () => {
    for (const code of ['23503', '23001']) {
      expect(traduzir(pg(code, 'violates foreign key constraint'))).toMatchObject({
        status: 422, corpo: { codigo: 'referencia_invalida' },
      });
    }
  });

  it('22P02, 22007, 22008, 22003, 22001 e 23502 viram 400 dados_invalidos', () => {
    for (const code of ['22P02', '22007', '22008', '22003', '22001', '23502']) {
      expect(traduzir(pg(code, 'x'))).toMatchObject({ status: 400, corpo: { codigo: 'dados_invalidos' } });
    }
  });

  it('sqlstate desconhecido e erro que não é do banco sobem como vieram', () => {
    const doBanco = pg('42P01', 'relation "public.videos" does not exist');
    expect(traduzir(doBanco).original).toBe(doBanco);
    const outro = new Error('rede caiu');
    expect(traduzir(outro).original).toBe(outro);
  });
});

describe('erros fixos de serviço', () => {
  it('cada um tem status, codigo e texto em português', () => {
    const esperado: Array<[keyof typeof ERROS, number, string, string]> = [
      ['naoEncontrado', 404, 'nao_encontrado', 'Fachada não encontrada.'],
      ['leadNaoEncontrado', 404, 'lead_nao_encontrado', 'Lead não encontrado.'],
      ['templateNaoEncontrado', 404, 'template_nao_encontrado', 'Template não encontrado.'],
      ['fachadaIndisponivel', 404, 'fachada_indisponivel', 'Esta placa não está mais disponível.'],
      ['nadaParaAtualizar', 400, 'nada_para_atualizar', 'Nada para atualizar.'],
      ['idInvalido', 400, 'id_invalido', 'Identificador inválido.'],
      ['corretorNaoIdentificado', 403, 'corretor_nao_identificado', 'Não foi possível identificar o corretor.'],
    ];
    for (const [chave, status, codigo, message] of esperado) {
      const e = ERROS[chave]();
      expect(e.getStatus()).toBe(status);
      expect(e.getResponse()).toEqual({ statusCode: status, codigo, message });
    }
  });
});
