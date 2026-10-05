import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims } from '../../prisma/tenant-db';
import { COLUNAS_PARCEIRO } from './admin.service';
import { AdminService } from './admin.service';

const USER = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const OUTRO = '33333333-3333-4333-8333-333333333333';
const claims: SupabaseClaims = { sub: USER, role: 'authenticated', email: 'admin@x.com' };

function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  tx.$queryRaw.mockResolvedValue([]);
  tx.$executeRaw.mockResolvedValue(0);
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, db, servico: new AdminService(db as never) };
}

const sql = (m: jest.Mock, i = 0) => m.mock.calls[i][0] as Prisma.Sql;
const texto = (m: jest.Mock, i = 0) => sql(m, i).text.replace(/\s+/g, ' ').trim();

async function erroDe(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as Record<string, unknown>) };
    throw e;
  }
  throw new Error('não lançou');
}

interface Caso {
  rota: string;
  chamar: (s: AdminService) => Promise<unknown>;
  contem: string;
  valores?: unknown[];
  linhas?: unknown[];
}

const CASOS: Caso[] = [
  { rota: 'B1', chamar: (s) => s.papeis(claims), contem: 'public.meus_papeis()', valores: [], linhas: [{ papeis: ['admin'] }] },
  {
    rota: 'B2', chamar: (s) => s.listarAuditoria(claims, { entidade: 'parceiros', acao: 'criar', de: '2026-01-01', ate: '2026-02-01' }),
    contem: 'public.admin_listar_auditoria($1::text, $2::text, $3::date, $4::date, $5::int, $6::int)',
    valores: ['parceiros', 'criar', '2026-01-01', '2026-02-01', 50, 0],
  },
  {
    rota: 'B2 padrão 50', chamar: (s) => s.listarAuditoria(claims, { pagina: 3 }),
    contem: 'public.admin_listar_auditoria', valores: [null, null, null, null, 50, 100],
  },
  {
    rota: 'B3', chamar: (s) => s.registrarAuditoria(claims, { acao: 'x', entidade: 'parceiros', entidade_id: ID }),
    contem: 'public.registrar_auditoria_admin($1::text, $2::text, $3::text, $4::jsonb, $5::jsonb, $6::text)::int as id',
    valores: ['x', 'parceiros', ID, null, null, null], linhas: [{ id: 7 }],
  },
  {
    rota: 'B4', chamar: (s) => s.listarParceiros(claims, { busca: 'ana', status: 'ativo', pagina: 2, por_pagina: 10 }),
    contem: 'public.admin_listar_parceiros($1::text, $2::text, $3::int, $4::int)', valores: ['ana', 'ativo', 10, 10],
  },
  { rota: 'B5', chamar: (s) => s.opcoesParceiros(claims), contem: 'public.admin_opcoes_parceiros()', valores: [] },
  {
    rota: 'B9', chamar: (s) => s.definirPercentual(claims, ID, { percentual: 12.5, base_calculo: 'receita_bruta' }),
    contem: 'public.admin_definir_percentual($1::uuid, $2::numeric, $3::text, $4::numeric, $5::date, $6::text)',
    valores: [ID, 12.5, 'receita_bruta', null, null, null],
  },
  {
    rota: 'B12', chamar: (s) => s.listarComissoes(claims, { parceiro_id: ID, status: 'aprovada' }),
    contem: 'public.admin_listar_comissoes($1::uuid, $2::text, $3::date, $4::date, $5::int, $6::int)',
    valores: [ID, 'aprovada', null, null, 25, 0],
  },
  {
    rota: 'B13', chamar: (s) => s.transicionarComissao(claims, ID, { novo_status: 'aprovada' }),
    contem: 'public.admin_transicionar_comissao($1::uuid, $2::text, $3::text)', valores: [ID, 'aprovada', null],
  },
  {
    rota: 'B14', chamar: (s) => s.registrarPagamento(claims, { parceiro_id: ID, comissao_ids: [OUTRO] }),
    contem: 'public.admin_registrar_pagamento($1::uuid, $2::uuid[], $3::text, $4::text, $5::date, $6::text)',
    valores: [ID, [OUTRO], null, null, null, null],
  },
  {
    rota: 'B15', chamar: (s) => s.listarReceita(claims, { corretor_id: ID }),
    contem: 'public.admin_listar_receita($1::uuid, $2::text, $3::date, $4::date, $5::int, $6::int)',
    valores: [ID, null, null, null, 25, 0],
  },
  {
    rota: 'B16',
    chamar: (s) => s.registrarReceita(claims, {
      corretor_id: ID, valor_bruto: 99.9, confirmado_em: '2026-10-01T00:00:00.000Z', motivo: 'ajuste manual conferido',
    }),
    contem: 'public.admin_registrar_receita($1::uuid, $2::numeric, $3::timestamptz, $4::text, $5::numeric, $6::date, $7::text)',
    valores: [ID, 99.9, '2026-10-01T00:00:00.000Z', 'assinatura', null, null, 'ajuste manual conferido'],
  },
  {
    rota: 'B17', chamar: (s) => s.estornarReceita(claims, ID, { motivo: 'chargeback confirmado' }),
    contem: 'public.admin_estornar_receita($1::uuid, $2::text)', valores: [ID, 'chargeback confirmado'],
  },
  {
    rota: 'B18', chamar: (s) => s.elegiveisRepasse(claims, 50),
    contem: 'public.admin_parceiros_elegiveis_repasse($1::numeric)', valores: [50],
  },
  {
    rota: 'B19', chamar: (s) => s.listarLotes(claims, { status: 'rascunho', pagina: 2 }),
    contem: 'public.admin_listar_lotes($1::text, $2::int, $3::int)', valores: ['rascunho', 2, 25],
  },
  { rota: 'B20', chamar: (s) => s.lote(claims, ID), contem: 'public.admin_detalhe_lote($1::uuid)', valores: [ID] },
  {
    rota: 'B21', chamar: (s) => s.gerarLote(claims, { parceiro_ids: [ID, OUTRO] }),
    contem: 'public.admin_gerar_lote_repasse($1::uuid[], $2::numeric, $3::text)', valores: [[ID, OUTRO], null, null],
  },
  {
    rota: 'B22', chamar: (s) => s.marcarLoteExportado(claims, ID),
    contem: 'public.admin_marcar_lote_exportado($1::uuid)', valores: [ID],
  },
  {
    rota: 'B23', chamar: (s) => s.marcarLotePago(claims, ID, { pago_em: '2026-10-01', referencia: 'TED 123' }),
    contem: 'public.admin_marcar_lote_pago($1::uuid, $2::date, $3::text, $4::text)',
    valores: [ID, '2026-10-01', 'TED 123', null],
  },
  {
    rota: 'B24', chamar: (s) => s.cancelarLote(claims, ID, { motivo: 'erro de geracao' }),
    contem: 'public.admin_cancelar_lote($1::uuid, $2::text)', valores: [ID, 'erro de geracao'],
  },
  {
    rota: 'B25', chamar: (s) => s.listarUsuarios(claims, { busca: 'ana' }),
    contem: 'public.admin_listar_usuarios($1::text, $2::text, $3::text, $4::uuid, $5::date, $6::date, $7::text, $8::text, $9::int, $10::int)',
    valores: ['ana', null, null, null, null, null, 'criado_em', 'desc', 25, 0],
  },
  { rota: 'B26', chamar: (s) => s.usuario(claims, ID), contem: 'public.admin_detalhe_usuario($1::uuid)', valores: [ID] },
  {
    rota: 'B27', chamar: (s) => s.definirStatusCorretor(claims, ID, { status: 'suspenso', motivo: 'inadimplencia longa' }),
    contem: 'public.admin_definir_status_corretor($1::uuid, $2::text, $3::text)', valores: [ID, 'suspenso', 'inadimplencia longa'],
  },
  {
    rota: 'B28', chamar: (s) => s.listarAtendimento(claims, { parceiro_id: ID }),
    contem: 'public.admin_listar_atendimento($1::text, $2::text, $3::uuid, $4::boolean, $5::text, $6::int, $7::int)',
    valores: [null, null, ID, false, null, 25, 0],
  },
  {
    rota: 'B29', chamar: (s) => s.listarAssinaturas(claims, { status: 'active' }),
    contem: 'public.admin_listar_assinaturas($1::text, $2::text, $3::text, $4::text, $5::int, $6::int)',
    valores: [null, 'active', null, null, 1, 25],
  },
  {
    rota: 'B30', chamar: (s) => s.listarPagamentos(claims, { metodo: 'pix' }),
    contem: 'public.admin_listar_pagamentos($1::text, $2::text, $3::text, $4::text, $5::date, $6::date, $7::int, $8::int)',
    valores: [null, null, 'pix', null, null, null, 1, 25],
  },
  {
    rota: 'B31', chamar: (s) => s.listarCancelamentos(claims, { origem: 'suporte' }),
    contem: 'public.admin_listar_cancelamentos($1::text, $2::text, $3::text, $4::date, $5::date, $6::int, $7::int)',
    valores: [null, 'suporte', null, null, null, 1, 25],
  },
  {
    rota: 'B32', chamar: (s) => s.registrarCancelamento(claims, { motivo: 'preco' }),
    contem: 'public.admin_registrar_cancelamento($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::date)',
    valores: ['preco', null, null, null, null, null, null, 'outro', null],
  },
  {
    rota: 'B33 lista', chamar: (s) => s.listarOrganizacoes(claims, { busca: 'x' }),
    contem: 'public.admin_listar_organizacoes($1::text, $2::text, $3::text, $4::int, $5::int)',
    valores: ['x', null, null, 25, 0],
  },
  {
    rota: 'B33 detalhe', chamar: (s) => s.organizacao(claims, ID),
    contem: 'public.admin_detalhe_organizacao($1::uuid)', valores: [ID],
  },
  {
    rota: 'B34', chamar: (s) => s.listarAcessos(claims, { busca: 'x' }),
    contem: 'public.admin_listar_acessos($1::text, $2::int, $3::int)', valores: ['x', 25, 0],
  },
  {
    rota: 'B35', chamar: (s) => s.metricas(claims, { inicio: '2026-01-01', fim: '2026-02-01' }),
    contem: 'public.admin_metricas_visao_geral($1::date, $2::date)', valores: ['2026-01-01', '2026-02-01'],
  },
  {
    rota: 'B36', chamar: (s) => s.metricasSaas(claims, { inicio: '2026-01-01', fim: '2026-02-01' }),
    contem: 'public.admin_metricas_saas($1::date, $2::date)', valores: ['2026-01-01', '2026-02-01'],
  },
  {
    rota: 'B37', chamar: (s) => s.metricasCancelamento(claims, { inicio: '2026-01-01', fim: '2026-02-01' }),
    contem: 'public.admin_metricas_cancelamento($1::date, $2::date)', valores: ['2026-01-01', '2026-02-01'],
  },
  {
    rota: 'B38', chamar: (s) => s.metricasOnboarding(claims, { inicio: '2026-01-01T00:00:00', fim: '2026-02-01T00:00:00' }),
    contem: 'public.admin_onboarding_metricas($1::timestamptz, $2::timestamptz)',
    valores: ['2026-01-01T00:00:00', '2026-02-01T00:00:00'],
  },
  { rota: 'B39', chamar: (s) => s.statusIntegracoes(claims), contem: 'public.admin_status_integracoes()', valores: [] },
  { rota: 'B40', chamar: (s) => s.listarConfig(claims), contem: 'public.admin_listar_config()', valores: [] },
  {
    rota: 'B40b', chamar: (s) => s.listarLinhasConfig(claims),
    contem: 'from public.admin_config c order by c.chave asc limit $1::int', valores: [1000],
  },
  {
    rota: 'B42', chamar: (s) => s.salvarConfig(claims, 'programa_hold_dias', { valor: 7 }),
    contem: 'public.admin_salvar_config($1::text, $2::jsonb)', valores: ['programa_hold_dias', '7'],
  },
  {
    rota: 'B43', chamar: (s) => s.listarDiagnosticos(claims, {}),
    contem: 'from public.commercial_diagnostics d order by d.created_at desc, d.id desc limit $1::int offset $2::int',
    valores: [200, 0],
  },
];

describe('AdminService: cada rota chama a função ou a tabela certa', () => {
  it.each(CASOS.map((c) => [c.rota, c] as const))('%s', async (_rota, caso) => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValue((caso.linhas ?? [{ resultado: null }]));
    await caso.chamar(servico);
    expect(texto(tx.$queryRaw)).toContain(caso.contem);
    if (caso.valores) expect(sql(tx.$queryRaw).values).toEqual(caso.valores);
  });

  it('todo parâmetro leva cast explícito', async () => {
    for (const caso of CASOS) {
      const { tx, servico } = montar();
      tx.$queryRaw.mockResolvedValue((caso.linhas ?? [{ resultado: null }]));
      await caso.chamar(servico);
      for (const [q] of tx.$queryRaw.mock.calls) expect((q as Prisma.Sql).text).not.toMatch(/\$\d+(?!\d|::)/);
    }
  });

  it('nenhuma rota emite update ou delete em admin_auditoria', async () => {
    const textos: string[] = [];
    for (const caso of [...CASOS, ...MUTACOES]) {
      const { tx, servico } = montar();
      tx.$queryRaw.mockResolvedValue((caso.linhas ?? [{ resultado: null, id: ID, linha: {}, slug: 'x' }]));
      await caso.chamar(servico).catch(() => undefined);
      for (const [q] of tx.$queryRaw.mock.calls) textos.push((q as Prisma.Sql).text.replace(/\s+/g, ' ').toLowerCase());
      for (const [q] of tx.$executeRaw.mock.calls) textos.push((q as Prisma.Sql).text.replace(/\s+/g, ' ').toLowerCase());
    }
    expect(textos.some((t) => /(update|delete from) public\.admin_auditoria/.test(t))).toBe(false);
    expect(textos.some((t) => t.includes('admin_auditoria'))).toBe(false);
  });
});

const MUTACOES: Caso[] = [
  {
    rota: 'B7', chamar: (s) => s.criarParceiro(claims, { nome: 'Ana', email: 'ana@x.com', status: 'ativo' }),
    contem: 'insert into public.parceiros as x', linhas: [{ id: ID }],
  },
  {
    rota: 'B8', chamar: (s) => s.editarParceiro(claims, ID, { status: 'inativo' }),
    contem: 'update public.parceiros x set', linhas: [{ id: ID }],
  },
  {
    rota: 'B10', chamar: (s) => s.criarLink(claims, ID, { slug: 'ana-2026' }),
    contem: 'insert into public.parceiro_links as x', linhas: [{ id: OUTRO, slug: 'ana-2026' }],
  },
  {
    rota: 'B11', chamar: (s) => s.revogarLink(claims, ID),
    contem: 'update public.parceiro_links set ativo = false, revogado_em = now()', linhas: [{ id: ID }],
  },
  {
    rota: 'B41', chamar: (s) => s.atualizarConfig(claims, 'programa_hold_dias', { valor: 7 }),
    contem: 'update public.admin_config set valor = $1::jsonb, atualizado_em = now() where chave = $2::text',
    valores: ['7', 'programa_hold_dias'], linhas: [{ linha: { chave: 'programa_hold_dias' } }],
  },
  {
    rota: 'B44', chamar: (s) => s.atualizarStatusDiagnostico(claims, ID, { status: 'em_contato' }),
    contem: 'update public.commercial_diagnostics set status = $1::text where id = $2::uuid',
    valores: ['em_contato', ID], linhas: [{ linha: { id: ID } }],
  },
];

describe('AdminService: escritas B6–B11, B41, B44', () => {
  it.each(MUTACOES.map((c) => [c.rota, c] as const))('%s', async (_rota, caso) => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValue(caso.linhas);
    await caso.chamar(servico);
    expect(texto(tx.$queryRaw)).toContain(caso.contem);
    if (caso.valores) expect(sql(tx.$queryRaw).values).toEqual(caso.valores);
  });

  it('B6 faz as quatro consultas na ordem de useParceiro', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ linha: { id: ID } }])
      .mockResolvedValueOnce([{ linha: { percentual: 10 } }])
      .mockResolvedValueOnce([{ linha: { slug: 'ana' } }])
      .mockResolvedValueOnce([{ linha: { id: OUTRO, corretores: null } }]);
    const r = await servico.parceiro(claims, ID);
    expect(r).toEqual({
      parceiro: { id: ID }, percentuais: [{ percentual: 10 }], links: [{ slug: 'ana' }],
      atribuicoes: [{ id: OUTRO, corretores: null }],
    });
    expect(texto(tx.$queryRaw, 0)).toContain('from public.parceiros p where p.id = $1::uuid');
    expect(texto(tx.$queryRaw, 1)).toContain('order by pp.vigencia_inicio desc, pp.id desc limit $2::int');
    expect(texto(tx.$queryRaw, 2)).toContain('order by l.criado_em desc, l.id desc limit $2::int');
    expect(texto(tx.$queryRaw, 3)).toContain("jsonb_build_object('corretores'");
    expect(sql(tx.$queryRaw, 3).values).toEqual([ID, 100]);
  });

  it('B6 sem parceiro dá 404', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValue([]);
    expect(await erroDe(servico.parceiro(claims, ID))).toMatchObject({ status: 404, codigo: 'nao_encontrado' });
  });

  it('B7 grava só colunas de COLUNAS_PARCEIRO e criado_por de claims.sub', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValue([{ id: ID }]);
    await servico.criarParceiro(claims, { nome: 'Ana', email: 'ana@x.com', status: 'ativo', tipo: 'afiliado' });
    const consulta = sql(tx.$queryRaw);
    const colunas = /insert into public\.parceiros as x \(([^)]+)\)/.exec(consulta.text.replace(/\s+/g, ' '))![1]
      .split(',').map((c) => c.trim());
    expect(colunas[0]).toBe('criado_por');
    for (const c of colunas.slice(1)) expect(COLUNAS_PARCEIRO).toContain(c);
    expect(colunas).not.toContain('user_id');
    expect(colunas).not.toContain('convite_status');
    expect(consulta.values[0]).toBe(USER);
    expect(JSON.parse(String(consulta.values[1]))).toEqual({ nome: 'Ana', email: 'ana@x.com', status: 'ativo', tipo: 'afiliado' });
  });

  it('B8 com corpo vazio dá 400 nada_para_atualizar e não toca o banco', async () => {
    const { tx, servico } = montar();
    expect(await erroDe(servico.editarParceiro(claims, ID, {}))).toMatchObject({ status: 400, codigo: 'nada_para_atualizar' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('B8, B11, B41 e B44 sem linha dão 404 com o código certo', async () => {
    const casos: Array<[Promise<unknown>, string]> = [];
    const a = montar();
    a.tx.$queryRaw.mockResolvedValue([]);
    casos.push([a.servico.editarParceiro(claims, ID, { status: 'ativo' }), 'nao_encontrado']);
    const b = montar();
    b.tx.$queryRaw.mockResolvedValue([]);
    casos.push([b.servico.revogarLink(claims, ID), 'nao_encontrado']);
    const c = montar();
    c.tx.$queryRaw.mockResolvedValue([]);
    casos.push([c.servico.atualizarConfig(claims, 'chave_x', { valor: 1 }), 'config_desconhecida']);
    const d = montar();
    d.tx.$queryRaw.mockResolvedValue([]);
    casos.push([d.servico.atualizarStatusDiagnostico(claims, ID, { status: 'novo' }), 'diagnostico_nao_encontrado']);
    for (const [p, codigo] of casos) expect(await erroDe(p)).toMatchObject({ status: 404, codigo });
  });
});

describe('AdminService: paginação', () => {
  it('offset é (pagina - 1) * por_pagina e os padrões são 25, 50 e 200', async () => {
    const geral = montar();
    geral.tx.$queryRaw.mockResolvedValue([{ resultado: null }]);
    await geral.servico.listarParceiros(claims, { pagina: 4 });
    expect(sql(geral.tx.$queryRaw).values.slice(-2)).toEqual([25, 75]);

    const auditoria = montar();
    auditoria.tx.$queryRaw.mockResolvedValue([{ resultado: null }]);
    await auditoria.servico.listarAuditoria(claims, {});
    expect(sql(auditoria.tx.$queryRaw).values.slice(-2)).toEqual([50, 0]);

    const diag = montar();
    diag.tx.$queryRaw.mockResolvedValue([]);
    await diag.servico.listarDiagnosticos(claims, { pagina: 2 });
    expect(sql(diag.tx.$queryRaw).values).toEqual([200, 200]);
  });

  it('B3 devolve number (prova do ::int)', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValue([{ id: 42 }]);
    const r = await servico.registrarAuditoria(claims, { acao: 'x', entidade: 'y' });
    expect(r).toEqual({ id: 42 });
    expect(typeof r.id).toBe('number');
    expect(texto(tx.$queryRaw)).toContain('::int as id');
  });

  it('o resultado da RPC vai sem transformação', async () => {
    const { tx, servico } = montar();
    const bruto = { itens: [{ nome: 'Ana', valor: 10.5 }], total: 1 };
    tx.$queryRaw.mockResolvedValue([{ resultado: bruto }]);
    expect(await servico.listarParceiros(claims, {})).toBe(bruto);
  });

  it('42501 das RPCs vira 403 sem_permissao', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2010', clientVersion: 'teste', meta: { code: '42501', message: 'ERROR: acesso negado' },
    }));
    expect(await erroDe(servico.listarParceiros(claims, {}))).toMatchObject({ status: 403, codigo: 'sem_permissao' });
  });
});
