import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalvarRepasseDto } from '../parceiros.dto';
import { PortalService } from './portal.service';

const USER = '11111111-1111-4111-8111-111111111111';
const claims = { sub: USER, role: 'authenticated', email: 'parceiro@x.com' };

function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn(async () => 0) };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, db, servico: new PortalService(db as never) };
}

const sql = (m: jest.Mock, i: number) => m.mock.calls[i][0] as Prisma.Sql;
const texto = (m: jest.Mock, i: number) => sql(m, i).text.replace(/\s+/g, ' ').trim();

function erroBanco(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 'teste', meta: { code, message } });
}

async function erroDe(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as Record<string, unknown>) };
    throw e;
  }
  throw new Error('não lançou');
}

describe('T2 portal', () => {
  it('chama aceite, resumo e teto na ordem e monta a resposta', async () => {
    const { tx, db, servico } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ ok: true }])
      .mockResolvedValueOnce([{ resumo: { parceiro: { nome: 'Ana' }, comissoes: [] } }])
      .mockResolvedValueOnce([{ teto: 3 }]);
    const r = await servico.painel(claims);
    expect(r).toEqual({ parceiro: { nome: 'Ana' }, comissoes: [], teto_renovacoes: 3 });
    expect(texto(tx.$queryRaw, 0)).toContain('public.parceiro_portal_registrar_aceite()');
    expect(texto(tx.$queryRaw, 1)).toContain('public.parceiro_portal_resumo()');
    expect(texto(tx.$queryRaw, 2)).toContain('public.parceiro_portal_teto_renovacoes()');
    // Um run só: nunca existe "aceite carimbado, resumo falhou".
    expect(db.run).toHaveBeenCalledTimes(1);
  });

  it('teto nulo vira null', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ ok: true }])
      .mockResolvedValueOnce([{ resumo: {} }])
      .mockResolvedValueOnce([{ teto: null }]);
    expect(await servico.painel(claims)).toEqual({ teto_renovacoes: null });
  });

  it('42501 parceiro nao encontrado vira 403 parceiro_nao_vinculado', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('42501', 'ERROR: parceiro nao encontrado'));
    expect(await erroDe(servico.painel(claims))).toMatchObject({ status: 403, codigo: 'parceiro_nao_vinculado' });
  });
});

describe('T3 repasse', () => {
  const dto = Object.assign(new SalvarRepasseDto(), { documento: '12345678901', tipo_chave: 'cpf', chave: '123.456.789-01' });

  it('passa os três argumentos com ::text', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ ok: true }]);
    expect(await servico.salvarRepasse(claims, dto)).toEqual({ salvo: true });
    expect(texto(tx.$queryRaw, 0)).toContain('public.parceiro_portal_salvar_repasse($1::text, $2::text, $3::text)');
    expect(sql(tx.$queryRaw, 0).values).toEqual(['12345678901', 'cpf', '123.456.789-01']);
  });

  it('22023 vira 422 dados_de_repasse_invalidos', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('22023', 'ERROR: a chave precisa pertencer ao titular do documento'));
    expect(await erroDe(servico.salvarRepasse(claims, dto))).toMatchObject({
      status: 422, codigo: 'dados_de_repasse_invalidos', message: 'Confira o documento e a chave PIX do mesmo titular.',
    });
  });
});
