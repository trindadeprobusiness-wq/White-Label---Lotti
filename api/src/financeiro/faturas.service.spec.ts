import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FaturasService } from './faturas.service';
import { BaixaDto, CriarFaturaDto } from './financeiro.dto';
import { RepassesService } from './repasses.service';

const A = '11111111-1111-4111-8111-111111111111';
const CONTRATO = '22222222-2222-4222-8222-222222222222';
const claims = { sub: 'u1', role: 'authenticated' };

function montar(respostas: unknown[][] = []) {
  const tx = { $queryRaw: jest.fn(async (_q: Prisma.Sql) => respostas.shift() ?? []) };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, faturas: new FaturasService(db as never), repasses: new RepassesService(db as never) };
}

const texto = (q: Prisma.Sql) => q.text.replace(/\s+/g, ' ').trim();
const dto = <T extends object>(C: new () => T, d: Partial<T>): T => Object.assign(new C(), d);
const erroBanco = (code: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 't', meta: { code, message } });

async function erroDe(p: Promise<unknown>) {
  try { await p; } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
    throw e;
  }
  throw new Error('não lançou');
}

describe('FaturasService', () => {
  it('POST faturas manda só contrato, mês e vencimento: nenhum valor de dinheiro vem do cliente', async () => {
    const { tx, faturas } = montar([[{ novo_id: A, existente_id: null, tem_contrato: true }]]);
    expect(await faturas.garantirFatura(claims, dto(CriarFaturaDto, { contrato_id: CONTRATO, mes_referencia: '10/2026', data_vencimento: '2026-10-10' })))
      .toEqual({ id: A, criada: true });
    const q = tx.$queryRaw.mock.calls[0][0];
    expect(q.values).toEqual([CONTRATO, '2026-10-10', '10/2026', '10/2026']);
    expect(texto(q)).toContain('select c.id, c.cliente_id, c.imovel_id, c.corretor_id, c.valor,');
    expect(texto(q)).toContain('on conflict (contrato_id, mes_referencia) do nothing');
  });

  it('criada:false quando novo_id é null; 404 sem contrato; 409 quando a existente está oculta', async () => {
    expect(await montar([[{ novo_id: null, existente_id: A, tem_contrato: true }]]).faturas
      .garantirFatura(claims, dto(CriarFaturaDto, { contrato_id: CONTRATO, mes_referencia: '10/2026', data_vencimento: '2026-10-10' })))
      .toEqual({ id: A, criada: false });
    expect((await erroDe(montar([[{ novo_id: null, existente_id: null, tem_contrato: false }]]).faturas
      .garantirFatura(claims, dto(CriarFaturaDto, { contrato_id: CONTRATO, mes_referencia: '10/2026', data_vencimento: '2026-10-10' })))).body)
      .toEqual({ statusCode: 404, codigo: 'contrato_nao_encontrado', message: 'Contrato não encontrado.' });
    expect((await erroDe(montar([[{ novo_id: null, existente_id: null, tem_contrato: true }]]).faturas
      .garantirFatura(claims, dto(CriarFaturaDto, { contrato_id: CONTRATO, mes_referencia: '10/2026', data_vencimento: '2026-10-10' })))).status).toBe(409);
  });

  it('baixa usa f.valor_total do banco e recusa CANCELADO; 404 vs 409', async () => {
    const ok = montar([[{ linha: { id: A, status: 'PAGO' } }]]);
    expect(await ok.faturas.darBaixa(claims, A, dto(BaixaDto, { data_pagamento: '2026-10-05' }))).toEqual({ id: A, status: 'PAGO' });
    const t = texto(ok.tx.$queryRaw.mock.calls[0][0]);
    expect(t).toContain("set status = 'PAGO', data_pagamento = $1::date, valor_pago = f.valor_total");
    expect(t).toContain("where f.id = $2::uuid and f.status <> 'CANCELADO'");
    expect((await erroDe(montar([[], []]).faturas.darBaixa(claims, A, dto(BaixaDto, { data_pagamento: '2026-10-05' }))))).toEqual({
      status: 404, body: { statusCode: 404, codigo: 'fatura_nao_encontrada', message: 'Fatura não encontrada.' },
    });
    expect((await erroDe(montar([[], [{ status: 'CANCELADO' }]]).faturas.darBaixa(claims, A, dto(BaixaDto, { data_pagamento: '2026-10-05' }))))).toEqual({
      status: 409, body: { statusCode: 409, codigo: 'fatura_cancelada', message: 'Fatura cancelada.' },
    });
  });

  it.each([
    ['Fatura não encontrada ou sem permissão.', 404, 'fatura_nao_encontrada'],
    ['Só é possível desfazer o pagamento de faturas pagas.', 409, 'fatura_nao_paga'],
    ['O repasse ao proprietário desta fatura já foi executado — não é possível desfazer automaticamente.', 409, 'repasse_ja_executado'],
  ])('estorno: "%s" → %d %s', async (mensagem, status, codigo) => {
    const { tx, faturas } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('P0001', `ERROR: ${mensagem}`));
    expect(await erroDe(faturas.estornar(claims, A))).toEqual({ status, body: { statusCode: status, codigo, message: mensagem } });
  });

  it('estorno devolve o status da função', async () => {
    const { tx, faturas } = montar([[{ status: 'ATRASADO' }]]);
    expect(await faturas.estornar(claims, A)).toEqual({ status: 'ATRASADO' });
    expect(texto(tx.$queryRaw.mock.calls[0][0])).toBe('select public.estornar_pagamento_fatura($1::uuid) as status');
  });

  it('listas com teto e ordem estável; resumo agregado', async () => {
    const { tx, faturas } = montar([[], [{ contratos_ativos: 2, soma_valor: 5000 }]]);
    await faturas.listarFaturas(claims);
    expect(texto(tx.$queryRaw.mock.calls[0][0])).toBe('select to_jsonb(f) as linha from public.faturas_aluguel f order by f.data_vencimento, f.id limit $1::int');
    expect(await faturas.resumoLocacao(claims)).toEqual({ contratos_ativos: 2, soma_valor: 5000 });
  });
});

describe('RepassesService', () => {
  it('confirmar grava data_transferencia sem sobrescrever; sem linha → 404', async () => {
    const { tx, repasses } = montar([[{ linha: { id: A, status: 'CONFIRMADO' } }], []]);
    await repasses.confirmar(claims, A);
    expect(texto(tx.$queryRaw.mock.calls[0][0])).toContain("set status = 'CONFIRMADO', data_transferencia = coalesce(r.data_transferencia, current_date)");
    expect((await erroDe(repasses.confirmar(claims, A))).body).toEqual({ statusCode: 404, codigo: 'repasse_nao_encontrado', message: 'Repasse não encontrado.' });
  });
});
