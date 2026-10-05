import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConviteDto } from '../parceiros.dto';
import { ConviteService } from './convite.service';
import { ConviteSemProvedor, PortaDeConvite, ResultadoDoConvite } from './porta-convite';

const USER = '11111111-1111-4111-8111-111111111111';
const PARCEIRO = '22222222-2222-4222-8222-222222222222';
const CONTA = '33333333-3333-4333-8333-333333333333';
const claims = { sub: USER, role: 'authenticated', email: 'admin@x.com' };

const PARCEIRO_ATIVO: {
  id: string; nome: string; email: string; status: string; user_id: string | null; convite_status: string;
} = { id: PARCEIRO, nome: 'Parceira Ana', email: 'ana@x.com', status: 'ativo', user_id: null, convite_status: 'nao_enviado' };
const TERMOS = { percentual: 12, base_calculo: 'receita_bruta', valor_fixo: null, teto_renovacoes: null };

function montar(porta: PortaDeConvite) {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn(async () => 1) };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, db, servico: new ConviteService(db as never, porta) };
}

const sql = (m: jest.Mock, i: number) => m.mock.calls[i][0] as Prisma.Sql;
const texto = (m: jest.Mock, i: number) => sql(m, i).text.replace(/\s+/g, ' ').trim();
const dto = (dados: Partial<ConviteDto>) => Object.assign(new ConviteDto(), dados);

/** Carrega parceiro + termos + link; opcionalmente a criação antes. */
function prepararMocks(tx: { $queryRaw: jest.Mock }, parceiro: typeof PARCEIRO_ATIVO = PARCEIRO_ATIVO, criado?: string) {
  if (criado) tx.$queryRaw.mockResolvedValueOnce([{ resultado: { parceiro_id: criado } }]);
  tx.$queryRaw
    .mockResolvedValueOnce([parceiro])
    .mockResolvedValueOnce([TERMOS])
    .mockResolvedValueOnce([{ slug: 'ana' }]);
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

describe('T4 convite com porta que aceita', () => {
  const porta: PortaDeConvite = {
    enviarConvite: jest.fn(async (): Promise<ResultadoDoConvite> => ({ userId: CONTA, contaExistente: false })),
  };

  it('grava enviado e convidado_em, e monta os metadados', async () => {
    const { tx, servico } = montar(porta);
    prepararMocks(tx);
    const r = await servico.convidar(claims, dto({ parceiro_id: PARCEIRO }));
    expect(r).toEqual({ ok: true, email: 'ana@x.com', parceiro_id: PARCEIRO });
    const update = texto(tx.$executeRaw, 0);
    expect(update).toContain("convite_status = 'enviado'");
    expect(update).toContain('convidado_em = now()');
    expect(sql(tx.$executeRaw, 0).values).toEqual([CONTA, PARCEIRO]);
    expect(porta.enviarConvite).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ana@x.com',
      contaExistente: false,
      metadados: expect.objectContaining({
        tipo_acesso: 'parceiro', parceiro_id: PARCEIRO, nome_parceiro: 'Parceira Ana', comissao: '12%',
        regra_renovacao: 'A comissão também vale para as renovações enquanto esta regra estiver vigente.',
        link_parceiro: 'https://app.plataformalotti.com.br/r/ana',
      }),
    }));
  });

  it('contaExistente sai de parceiros.user_id, não do texto do provedor', async () => {
    const existente: PortaDeConvite = { enviarConvite: jest.fn(async () => ({ userId: null, contaExistente: true })) };
    const { tx, servico } = montar(existente);
    prepararMocks(tx, { ...PARCEIRO_ATIVO, user_id: CONTA });
    const r = await servico.convidar(claims, dto({ parceiro_id: PARCEIRO }));
    expect(r).toMatchObject({ ok: true, existing_account: true });
    expect(existente.enviarConvite).toHaveBeenCalledWith(expect.objectContaining({ contaExistente: true }));
  });
});

describe('T4 convite com a ConviteSemProvedor real', () => {
  it('acao criar: cria o parceiro, responde ok:false e grava falhou', async () => {
    const { tx, db, servico } = montar(new ConviteSemProvedor());
    prepararMocks(tx, PARCEIRO_ATIVO, PARCEIRO);
    const r = await servico.convidar(claims, dto({ acao: 'criar', dados: { parceiro: { nome: 'Ana' } } }));
    expect(r).toEqual({
      ok: false, parceiro_id: PARCEIRO, email_enviado: false,
      error: 'Cadastro salvo. O envio de convites por e-mail ainda não está configurado no servidor.',
    });
    expect(texto(tx.$queryRaw, 0)).toContain('public.admin_criar_parceiro_completo');
    // O convite_status = 'falhou' roda num segundo run, depois do primeiro confirmado.
    expect(db.run).toHaveBeenCalledTimes(2);
    expect(texto(tx.$executeRaw, 0)).toContain("convite_status = 'falhou'");
    expect(JSON.stringify(r)).not.toContain('503');
  });

  it('reenvio puro: 503 provedor_de_email_nao_configurado e convite_status falhou', async () => {
    const { tx, servico } = montar(new ConviteSemProvedor());
    prepararMocks(tx);
    expect(await erroDe(servico.convidar(claims, dto({ parceiro_id: PARCEIRO })))).toMatchObject({
      status: 503, codigo: 'provedor_de_email_nao_configurado',
      message: 'O envio de convites por e-mail ainda não está configurado no servidor.',
    });
    expect(texto(tx.$executeRaw, 0)).toContain("convite_status = 'falhou'");
  });

  it('nenhuma mensagem de erro do provedor aparece na resposta', async () => {
    const porta: PortaDeConvite = { enviarConvite: jest.fn(async () => { throw new Error('SMTP 550 mailbox unavailable'); }) };
    const { tx, servico } = montar(porta);
    prepararMocks(tx, PARCEIRO_ATIVO, PARCEIRO);
    const r = await servico.convidar(claims, dto({ acao: 'criar', dados: {} }));
    expect(JSON.stringify(r)).not.toMatch(/SMTP|mailbox/);
  });
});

describe('T4 guardas de estado', () => {
  it('parceiro inexistente dá 404', async () => {
    const { tx, servico } = montar(new ConviteSemProvedor());
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await erroDe(servico.convidar(claims, dto({ parceiro_id: PARCEIRO })))).toMatchObject({
      status: 404, codigo: 'nao_encontrado',
    });
  });

  it('status diferente de ativo dá 409 parceiro_inativo', async () => {
    const { tx, servico } = montar(new ConviteSemProvedor());
    tx.$queryRaw.mockResolvedValueOnce([{ ...PARCEIRO_ATIVO, status: 'inativo' }]);
    expect(await erroDe(servico.convidar(claims, dto({ parceiro_id: PARCEIRO })))).toMatchObject({
      status: 409, codigo: 'parceiro_inativo',
    });
  });

  it('convite já aceito dá 409 convite_ja_aceito', async () => {
    const { tx, servico } = montar(new ConviteSemProvedor());
    tx.$queryRaw.mockResolvedValueOnce([{ ...PARCEIRO_ATIVO, convite_status: 'aceito' }]);
    expect(await erroDe(servico.convidar(claims, dto({ parceiro_id: PARCEIRO })))).toMatchObject({
      status: 409, codigo: 'convite_ja_aceito',
    });
  });

  it('a regra de renovação tem as três variantes de hoje', async () => {
    const porta: PortaDeConvite = { enviarConvite: jest.fn(async () => ({ userId: CONTA, contaExistente: false })) };
    const casos: Array<[Record<string, unknown>, string, string]> = [
      [{ base_calculo: 'primeiro_pagamento' }, 'Somente o primeiro pagamento de cada indicado gera comissão.', '12%'],
      [{ teto_renovacoes: 2 }, 'A comissão vale para o primeiro pagamento e até 2 renovações por indicado.', '12%'],
      [{ base_calculo: 'valor_fixo', valor_fixo: 50 }, 'A comissão também vale para as renovações enquanto esta regra estiver vigente.', 'R$ 50.00'],
    ];
    for (const [extra, regra, comissao] of casos) {
      const { tx, servico } = montar(porta);
      tx.$queryRaw
        .mockResolvedValueOnce([PARCEIRO_ATIVO])
        .mockResolvedValueOnce([{ ...TERMOS, ...extra }])
        .mockResolvedValueOnce([]);
      await servico.convidar(claims, dto({ parceiro_id: PARCEIRO }));
      expect(porta.enviarConvite).toHaveBeenLastCalledWith(expect.objectContaining({
        metadados: expect.objectContaining({ regra_renovacao: regra, comissao, link_parceiro: '' }),
      }));
    }
  });
});
