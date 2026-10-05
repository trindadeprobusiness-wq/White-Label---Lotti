import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { erroPg, traduzirErroBanco } from './crm-clientes.erros';
import { CrmClientesService } from './crm-clientes.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const claims = { sub: 'u1', role: 'authenticated' };
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface SqlFalso { text: string; values: unknown[] }

function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const db = { run: jest.fn(async (_c: unknown, w: (t: unknown) => unknown) => w(tx)) };
  const servico = new CrmClientesService(db as never);
  const consulta = (i: number) => tx.$queryRaw.mock.calls[i][0] as SqlFalso;
  return { tx, db, servico, consulta };
}

function erroBanco(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 'teste', meta: { code, message } });
}

/** Executa e devolve a HttpException lançada (falha se não lançar uma). */
async function capturar(p: Promise<unknown>): Promise<{ status: number; corpo: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), corpo: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('era para lançar');
}

describe('tradutor de erros do banco', () => {
  it('lê SQLSTATE, mensagem sem prefixo (em inglês ou português) e o DETAIL', () => {
    expect(erroPg(erroBanco('P0001', 'ERRO: duplicate_client_phone\nDETALHE: ' + A))).toEqual({
      sqlstate: 'P0001', mensagem: 'duplicate_client_phone', detalhe: A, bruto: 'ERRO: duplicate_client_phone\nDETALHE: ' + A,
    });
    expect(erroPg(new Error('x'))).toBeNull();
  });

  it('erro que não é do banco, ou SQLSTATE desconhecido, sobe como veio', () => {
    const comum = new Error('rede');
    expect(() => traduzirErroBanco(comum)).toThrow(comum);
    const outro = erroBanco('40001', 'ERROR: serialization failure');
    expect(() => traduzirErroBanco(outro)).toThrow(outro);
  });
});

describe('CrmClientesService', () => {
  it('lista pelo TenantDb no formato do PostgREST, com cliente_imovel embutido e teto de 1000', async () => {
    const { tx, db, servico, consulta } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A, cliente_imovel: [] } }]);
    expect(await servico.listar(claims)).toEqual([{ id: A, cliente_imovel: [] }]);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    const q = consulta(0);
    expect(q.text).toMatch(/to_jsonb\(c\)/);
    expect(q.text).toMatch(/'cliente_imovel'/);
    expect(q.text).toMatch(/'\[\]'::jsonb/);
    expect(q.text).toMatch(/order by c\.created_at desc nulls first, c\.id/);
    expect(q.text).toMatch(/limit \$\d+::int/);
    expect(q.values).toEqual([1000]);
    expect(q.text).not.toMatch(/corretor_id/);
  });

  describe('candidatos', () => {
    it('chama crm_clientes_por_telefone com os três filtros em ::text (null quando ausentes)', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ r: [{ id: A, nome: 'Ana', motivo: 'telefone' }] }]);
      expect(await servico.buscarCandidatos(claims, { telefone: '62911110002' })).toEqual([{ id: A, nome: 'Ana', motivo: 'telefone' }]);
      const q = consulta(0);
      expect(q.text).toMatch(/public\.crm_clientes_por_telefone\(\$1::text, \$2::text, \$3::text\)/);
      expect(q.values).toEqual(['62911110002', null, null]);
    });

    it('devolve [] quando a função não traz nada', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ r: null }]);
      expect(await servico.buscarCandidatos(claims, {})).toEqual([]);
    });

    it('forbidden vira 403', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('P0001', 'ERROR: forbidden'));
      const { status, corpo } = await capturar(servico.buscarCandidatos(claims, { telefone: '1' }));
      expect(status).toBe(403);
      expect(corpo.codigo).toBe('forbidden');
    });
  });

  describe('criar', () => {
    it('chama crm_criar_cliente com o JSON do DTO em ::jsonb, sem corretor_id, e devolve o jsonb como veio', async () => {
      const { tx, db, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ r: { status: 'created', cliente_id: A } }]);
      const dto = { nome: 'Ana', telefone: '(62) 91111-0002', email: null, observacoes: undefined, status_funil: 'QUALIFICACAO' };
      expect(await servico.criar(claims, dto as never)).toEqual({ status: 'created', cliente_id: A });
      expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
      const q = consulta(0);
      expect(q.text).toMatch(/select public\.crm_criar_cliente\(\$1::jsonb\) as r/);
      expect(q.text).not.toMatch(/insert/i);
      expect(JSON.parse(q.values[0] as string)).toEqual({ nome: 'Ana', telefone: '(62) 91111-0002', email: null, status_funil: 'QUALIFICACAO' });
      expect(q.values[0]).not.toMatch(/corretor_id/);
    });

    it('duplicate não é erro: devolve os candidatos', async () => {
      const { tx, servico } = montar();
      const r = { status: 'duplicate', candidatos: [{ id: B, nome: 'Bia', motivo: 'telefone' }] };
      tx.$queryRaw.mockResolvedValueOnce([{ r }]);
      expect(await servico.criar(claims, { nome: 'Ana', telefone: '62911110002' } as never)).toEqual(r);
    });

    it('invalid_name vira 422 e forbidden vira 403 com textos em português', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('P0001', 'ERROR: invalid_name'));
      const nome = await capturar(servico.criar(claims, { nome: '', telefone: '' } as never));
      expect(nome).toEqual({ status: 422, corpo: { statusCode: 422, codigo: 'invalid_name', message: 'Informe o nome do cliente.' } });
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('P0001', 'ERROR: forbidden'));
      const conta = await capturar(servico.criar(claims, { nome: 'Ana', telefone: '' } as never));
      expect(conta.status).toBe(403);
      expect(conta.corpo).toMatchObject({ codigo: 'forbidden', message: 'Não foi possível identificar a sua conta. Entre novamente.' });
    });

    it('duplicate_client_phone vira 409 com o uuid do DETAIL em detalhe', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('P0001', `ERROR: duplicate_client_phone\nDETAIL: ${A}`));
      const { status, corpo } = await capturar(servico.criar(claims, { nome: 'Ana', telefone: '62911110002' } as never));
      expect(status).toBe(409);
      expect(corpo).toEqual({ statusCode: 409, codigo: 'duplicate_client_phone', message: 'Este telefone já é de outro cliente do CRM.', detalhe: A });
    });
  });

  describe('converter lead', () => {
    it('chama crm_converter_lead com os casts e só as chaves presentes em p_dados', async () => {
      const { tx, servico, consulta } = montar();
      const r = { status: 'converted', cliente_id: A, created: true, oportunidade_id: C };
      tx.$queryRaw.mockResolvedValueOnce([{ r }]);
      expect(await servico.converterLead(claims, { lead_id: B, etapa_id: C, nome: 'Ana', telefone: undefined, email: null } as never)).toEqual(r);
      const q = consulta(0);
      expect(q.text).toMatch(/public\.crm_converter_lead\(\$1::uuid, \$2::uuid, \$3::jsonb, \$4::uuid\)/);
      expect(q.values[0]).toBe(B);
      expect(q.values[1]).toBe(C);
      expect(JSON.parse(q.values[2] as string)).toEqual({ nome: 'Ana', email: null });
      expect(q.values[3]).toBeNull();
    });

    it('sem etapa e com cliente escolhido', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ r: { status: 'ja_convertido', cliente_id: A } }]);
      await servico.converterLead(claims, { lead_id: B, cliente_id: A } as never);
      expect(consulta(0).values[1]).toBeNull();
      expect(consulta(0).values[3]).toBe(A);
      expect(JSON.parse(consulta(0).values[2] as string)).toEqual({});
    });

    it('forbidden vira 403 com o texto da conversão; invalid_stage vira 422', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('P0001', 'ERROR: forbidden'));
      const f = await capturar(servico.converterLead(claims, { lead_id: B } as never));
      expect(f.status).toBe(403);
      expect(f.corpo.message).toBe('Este lead não é de uma fachada sua, ou o cliente escolhido é de outra conta.');
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('P0001', 'ERROR: invalid_stage'));
      const s = await capturar(servico.converterLead(claims, { lead_id: B, etapa_id: C } as never));
      expect(s.status).toBe(422);
      expect(s.corpo.codigo).toBe('invalid_stage');
    });
  });

  describe('obter', () => {
    it('lê uma linha com to_jsonb e o id em ::uuid', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A, nome: 'Ana' } }]);
      expect(await servico.obter(claims, A)).toEqual({ id: A, nome: 'Ana' });
      expect(consulta(0).text).toMatch(/to_jsonb\(c\) as linha from public\.clientes c where c\.id = \$1::uuid/);
      expect(consulta(0).values).toEqual([A]);
    });

    it('sem linha vira 404', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockResolvedValueOnce([]);
      expect(await capturar(servico.obter(claims, A))).toEqual({
        status: 404, corpo: { statusCode: 404, codigo: 'cliente_nao_encontrado', message: 'Cliente não encontrado.' },
      });
    });
  });

  describe('atualizar', () => {
    it('grava só as colunas editáveis presentes, por jsonb_populate_record', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A, nome: 'Ana' } }]);
      const dto = { nome: 'Ana', telefone: undefined, email: null, tipo_interesse: undefined, observacoes: undefined, ultimo_contato: undefined };
      expect(await servico.atualizar(claims, A, dto as never)).toEqual({ id: A, nome: 'Ana' });
      const q = consulta(0);
      expect(q.text).toMatch(/update public\.clientes t set \(nome, email\) = \(select r\.nome, r\.email from jsonb_populate_record\(null::public\.clientes, \$1::jsonb\) r\)/);
      expect(q.text).toMatch(/where t\.id = \$2::uuid returning to_jsonb\(t\) as linha/);
      expect(JSON.parse(q.values[0] as string)).toEqual({ nome: 'Ana', email: null });
      expect(q.values[1]).toBe(A);
    });

    it('nunca usa coluna fora da lista, mesmo que venha no objeto', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A } }]);
      await servico.atualizar(claims, A, { ultimo_contato: '2026-10-04T12:00:00.000Z', cpf: '1', corretor_id: B } as never);
      expect(consulta(0).text).toMatch(/set \(ultimo_contato\) = \(select r\.ultimo_contato from/);
      expect(JSON.parse(consulta(0).values[0] as string)).toEqual({ ultimo_contato: '2026-10-04T12:00:00.000Z' });
    });

    it('sem coluna vira 400 e zero linhas vira 404', async () => {
      const { tx, servico } = montar();
      expect((await capturar(servico.atualizar(claims, A, { nome: undefined } as never))).corpo).toMatchObject({ codigo: 'nada_para_atualizar', message: 'Nada para atualizar.' });
      tx.$queryRaw.mockResolvedValueOnce([]);
      const r = await capturar(servico.atualizar(claims, A, { nome: 'Ana' } as never));
      expect(r.status).toBe(404);
      expect(r.corpo.codigo).toBe('cliente_nao_encontrado');
    });

    it('telefone de outro cliente vira 409 com detalhe; RLS vira 403 com o texto da edição', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('P0001', `ERROR: duplicate_client_phone\nDETAIL: ${B}`));
      const dup = await capturar(servico.atualizar(claims, A, { telefone: '62911110002' } as never));
      expect(dup.status).toBe(409);
      expect(dup.corpo.detalhe).toBe(B);
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('42501', 'ERROR: new row violates row-level security policy for table "clientes"'));
      const rls = await capturar(servico.atualizar(claims, A, { nome: 'Ana' } as never));
      expect(rls).toEqual({ status: 403, corpo: { statusCode: 403, codigo: 'sem_permissao', message: 'Você não tem permissão para alterar este cliente.' } });
    });
  });

  describe('mover no funil', () => {
    it('grava o status com ::public.status_funil e devolve o id', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ id: A }]);
      expect(await servico.moverNoFunil(claims, A, { status_funil: 'DOCUMENTACAO' })).toEqual({ id: A });
      const q = consulta(0);
      expect(q.text).toMatch(/update public\.clientes set status_funil = \$1::public\.status_funil where id = \$2::uuid returning id/);
      expect(q.values).toEqual(['DOCUMENTACAO', A]);
    });

    it('zero linhas vira 404; o bug do gatilho legado (22P02) vira 400 dados_invalidos', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockResolvedValueOnce([]);
      expect((await capturar(servico.moverNoFunil(claims, A, { status_funil: 'DOCUMENTACAO' }))).status).toBe(404);
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('22P02', 'ERROR: invalid input value for enum status_funil: "Sem etapa"'));
      const r = await capturar(servico.moverNoFunil(claims, A, { status_funil: 'DOCUMENTACAO' }));
      expect(r.status).toBe(400);
      expect(r.corpo.codigo).toBe('dados_invalidos');
    });
  });

  describe('remover', () => {
    it('apaga pelo id e não devolve nada', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ id: A }]);
      await expect(servico.remover(claims, A)).resolves.toBeUndefined();
      expect(consulta(0).text).toMatch(/delete from public\.clientes where id = \$1::uuid returning id/);
    });

    it('zero linhas vira 404 com o texto de nada apagado', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockResolvedValueOnce([]);
      expect(await capturar(servico.remover(claims, A))).toEqual({
        status: 404,
        corpo: { statusCode: 404, codigo: 'cliente_nao_encontrado', message: 'Nada foi apagado: o cliente não existe ou você não tem permissão.' },
      });
    });

    it('contrato vinculado (23503 citando contratos) vira 409 cliente_com_contrato', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockRejectedValueOnce(erroBanco('23503',
        'ERROR: update or delete on table "clientes" violates foreign key constraint "contratos_cliente_id_fkey" on table "contratos"\nDETAIL: Key (id)=(x) is still referenced from table "contratos".'));
      expect(await capturar(servico.remover(claims, A))).toEqual({
        status: 409,
        corpo: { statusCode: 409, codigo: 'cliente_com_contrato', message: 'Existem contratos vinculados a este cliente.', sqlstate: '23503' },
      });
    });
  });

  describe('imóvel de interesse', () => {
    it('confere cliente e imóvel da mesma conta, depois apaga e insere, num run só', async () => {
      const { tx, db, servico, consulta } = montar();
      tx.$queryRaw
        .mockResolvedValueOnce([{ corretor_id: C }])
        .mockResolvedValueOnce([{ '?column?': 1 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      expect(await servico.definirImovelInteresse(claims, A, { imovel_id: B })).toEqual({ cliente_id: A, imovel_id: B });
      expect(db.run).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
      expect(consulta(0).text).toMatch(/select corretor_id::text as corretor_id from public\.clientes where id = \$1::uuid/);
      expect(consulta(1).text).toMatch(/from public\.imoveis where id = \$1::uuid and corretor_id = \$2::uuid/);
      expect(consulta(1).values).toEqual([B, C]);
      expect(consulta(2).text).toMatch(/delete from public\.cliente_imovel where cliente_id = \$1::uuid/);
      expect(consulta(3).text).toMatch(/insert into public\.cliente_imovel \(cliente_id, imovel_id\) values \(\$1::uuid, \$2::uuid\) on conflict \(cliente_id, imovel_id\) do nothing/);
      expect(consulta(3).values).toEqual([A, B]);
    });

    it('imovel_id null ou ausente só apaga o vínculo', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ corretor_id: C }]).mockResolvedValueOnce([]);
      expect(await servico.definirImovelInteresse(claims, A, { imovel_id: null })).toEqual({ cliente_id: A, imovel_id: null });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(consulta(1).text).toMatch(/delete from public\.cliente_imovel/);
      tx.$queryRaw.mockClear();
      tx.$queryRaw.mockResolvedValueOnce([{ corretor_id: C }]).mockResolvedValueOnce([]);
      expect(await servico.definirImovelInteresse(claims, A, {})).toEqual({ cliente_id: A, imovel_id: null });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('imóvel de outra conta vira 404 e nada é apagado', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ corretor_id: C }]).mockResolvedValueOnce([]);
      expect(await capturar(servico.definirImovelInteresse(claims, A, { imovel_id: B }))).toEqual({
        status: 404, corpo: { statusCode: 404, codigo: 'imovel_nao_encontrado', message: 'Imóvel não encontrado.' },
      });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('cliente invisível vira 404 cliente_nao_encontrado', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockResolvedValueOnce([]);
      const r = await capturar(servico.definirImovelInteresse(claims, A, { imovel_id: B }));
      expect(r.status).toBe(404);
      expect(r.corpo).toMatchObject({ codigo: 'cliente_nao_encontrado', message: 'Cliente não encontrado.' });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('RLS no insert vira 403 com o texto da edição', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw
        .mockResolvedValueOnce([{ corretor_id: C }])
        .mockResolvedValueOnce([{ '?column?': 1 }])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(erroBanco('42501', 'ERROR: new row violates row-level security policy for table "cliente_imovel"'));
      const r = await capturar(servico.definirImovelInteresse(claims, A, { imovel_id: B }));
      expect(r.status).toBe(403);
      expect(r.corpo.message).toBe('Você não tem permissão para alterar este cliente.');
    });
  });

  describe('completar CPF', () => {
    it('só preenche CPF nulo, com cpf em ::text', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ id: A }]);
      expect(await servico.completarCpf(claims, A, { cpf: '12345678909' })).toEqual({ atualizado: true });
      const q = consulta(0);
      expect(q.text).toMatch(/update public\.clientes set cpf = \$1::text where id = \$2::uuid and cpf is null returning id/);
      expect(q.values).toEqual(['12345678909', A]);
    });

    it('zero linhas é atualizado: false, sem 404', async () => {
      const { tx, servico } = montar();
      tx.$queryRaw.mockResolvedValueOnce([]);
      expect(await servico.completarCpf(claims, A, { cpf: '12345678909' })).toEqual({ atualizado: false });
    });
  });

  describe('histórico', () => {
    it('lista do cliente, mais recente primeiro, com desempate e teto', async () => {
      const { tx, servico, consulta } = montar();
      tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: B, cliente_id: A } }]);
      expect(await servico.listarHistorico(claims, A)).toEqual([{ id: B, cliente_id: A }]);
      const q = consulta(0);
      expect(q.text).toMatch(/to_jsonb\(h\) as linha from public\.historico_contatos h where h\.cliente_id = \$1::uuid order by h\.data_contato desc, h\.id limit \$2::int/);
      expect(q.values).toEqual([A, 1000]);
    });

    it('grava sem RETURNING por $executeRaw, com id v4 do servidor, e monta a resposta com now()', async () => {
      const { tx, db, servico, consulta } = montar();
      tx.$executeRaw.mockResolvedValueOnce(1);
      tx.$queryRaw.mockImplementationOnce(async (q: SqlFalso) => [{ linha: { id: q.values[0], data_contato: 'agora' } }]);
      const resposta = await servico.registrarHistorico(claims, A, { tipo: 'WHATSAPP', conteudo: 'Olá', metadata: { via: 'wa.me' } });
      expect(db.run).toHaveBeenCalledTimes(1);
      const insert = tx.$executeRaw.mock.calls[0][0] as SqlFalso;
      expect(insert.text).toMatch(/insert into public\.historico_contatos \(id, cliente_id, tipo, direcao, conteudo, metadata\)/);
      expect(insert.text).not.toMatch(/returning/i);
      expect(insert.text).toMatch(/\$1::uuid, \$2::uuid, \$3::public\.canal_contato, \$4::public\.direcao_contato,\s+\$5::text, \$6::jsonb/);
      const [id, clienteId, tipo, direcao, conteudo, metadata] = insert.values;
      expect(id).toMatch(V4);
      expect(clienteId).toBe(A);
      expect(tipo).toBe('WHATSAPP');
      expect(direcao).toBe('OUT');
      expect(conteudo).toBe('Olá');
      expect(JSON.parse(metadata as string)).toEqual({ via: 'wa.me' });
      const montagem = consulta(0);
      expect(montagem.text).toMatch(/'data_contato', now\(\), 'created_at', now\(\)/);
      expect(montagem.text).toMatch(/'conteudo', \$5::text/);
      expect(montagem.text).toMatch(/'metadata', \$6::jsonb/);
      expect(montagem.text).not.toMatch(/historico_contatos/);
      expect(montagem.values).toEqual([id, A, 'WHATSAPP', 'OUT', 'Olá', metadata]);
      expect(resposta).toEqual({ id, data_contato: 'agora' });
    });

    it('direção informada e metadata ausente vira {}', async () => {
      const { tx, servico } = montar();
      tx.$executeRaw.mockResolvedValueOnce(1);
      tx.$queryRaw.mockResolvedValueOnce([{ linha: {} }]);
      await servico.registrarHistorico(claims, A, { tipo: 'TELEFONE', direcao: 'IN', conteudo: '' });
      const v = (tx.$executeRaw.mock.calls[0][0] as SqlFalso).values;
      expect(v[3]).toBe('IN');
      expect(v[4]).toBe('');
      expect(v[5]).toBe('{}');
    });

    it('sem policy de INSERT (42501) vira 403 com o texto do histórico', async () => {
      const { tx, servico } = montar();
      tx.$executeRaw.mockRejectedValueOnce(erroBanco('42501', 'ERROR: new row violates row-level security policy for table "historico_contatos"'));
      expect(await capturar(servico.registrarHistorico(claims, A, { tipo: 'WHATSAPP', conteudo: 'Olá' }))).toEqual({
        status: 403,
        corpo: { statusCode: 403, codigo: 'sem_permissao', message: 'Sua conta não tem permissão para registrar contatos deste cliente.' },
      });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
