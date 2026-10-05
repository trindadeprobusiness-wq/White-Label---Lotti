// SQL real do CrmClientesService (contrato do módulo 2, §2): cada método público roda no PGlite com todas as
// migrations de api/prisma/migrations, RLS ligado e o TenantDb de produção (claims + `set local role
// authenticated`). Para cada método: o caminho feliz no formato do PostgREST, o isolamento entre as contas A e B
// e os erros principais do banco traduzidos para o HTTP e o `codigo` do contrato.
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AtualizarClienteDto,
  ConverterLeadDto,
  CriarClienteDto,
  DefinirImovelInteresseDto,
  MoverClienteDto,
  RegistrarHistoricoDto,
} from '../../src/crm/clientes/crm-clientes.dto';
import { CrmClientesService } from '../../src/crm/clientes/crm-clientes.service';
import type { SupabaseClaims } from '../../src/prisma/tenant-db';
import { type BancoTeste, capturarErroHttp, criarBanco, USUARIO_A, USUARIO_B } from './harness';

type Linha = Record<string, unknown>;

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** timestamptz pelo to_jsonb, como o PostgREST entrega com o servidor em UTC. */
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const INEXISTENTE = '11111111-1111-4111-8111-111111111111';

/** Colunas de to_jsonb(public.clientes): a LinhaCliente do contrato. */
const CHAVES_CLIENTE = [
  'asaas_customer_id', 'corretor_id', 'cpf', 'created_at', 'email', 'endereco_completo', 'estado_civil', 'id',
  'is_sample_data', 'nacionalidade', 'nome', 'observacoes', 'profissao', 'proximo_followup', 'rg', 'status_funil',
  'telefone', 'tipo_interesse', 'tracking_data', 'ultimo_contato', 'updated_at',
];
const CHAVES_HISTORICO = ['cliente_id', 'conteudo', 'created_at', 'data_contato', 'direcao', 'id', 'metadata', 'tipo'];

const corpo = (status: number, codigo: string, message: string, extra: Linha = {}) =>
  ({ status, corpo: { statusCode: status, codigo, message, ...extra } });
const NAO_ENCONTRADO = corpo(404, 'cliente_nao_encontrado', 'Cliente não encontrado.');
const DADOS_INVALIDOS = corpo(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.');
const SEM_CONTA = corpo(403, 'forbidden', 'Não foi possível identificar a sua conta. Entre novamente.');

let banco: BancoTeste;
let servico: CrmClientesService;
/** Usuário autenticado sem conta de corretor: get_corretor_id() é nulo e as RPCs levantam `forbidden`. */
let semConta: SupabaseClaims;
let imovelA1: string;
let imovelA2: string;
let imovelB: string;
let etapaA: string;
let etapaB: string;
let clienteB: string;
let joao: string;
/** Criados pela própria rota no describe de criar. */
let maria: string;
let mariaNoB: string;

before(async () => {
  banco = await criarBanco();
  servico = new CrmClientesService(banco.db);
  semConta = { ...banco.claimsA, sub: randomUUID(), email: 'sem-conta@teste.lotti.local' };
  const imovel = async (corretor_id: string, titulo: string, semGatilhos = false) => (await banco.inserir('imoveis', {
    corretor_id, titulo, tipo: 'CASA', valor: 400000, endereco: 'Rua 1', cidade: 'Anápolis', proprietario_nome: 'Dono',
  }, { semGatilhos })).id as string;
  imovelA1 = await imovel(banco.corretorA, 'Casa 1 da A');
  imovelA2 = await imovel(banco.corretorA, 'Casa 2 da A');
  imovelB = await imovel(banco.corretorB, 'Casa do B', true); // B não tem plano: a trava de cota recusaria
  clienteB = (await banco.inserir('clientes', {
    corretor_id: banco.corretorB, nome: 'Cliente do B', telefone: '62991110002', email: 'cliente.b@exemplo.com', cpf: '98765432100',
  })).id as string;
  joao = (await banco.inserir('clientes', { corretor_id: banco.corretorA, nome: 'João Pereira', telefone: '62981110003' })).id as string;
  const primeiraEtapa = async (corretor: string) => (await banco.sqlSuperusuario<{ id: string }>(
    'select id::text as id from public.crm_etapas where corretor_id = $1::uuid order by ordem limit 1', [corretor]))[0].id;
  etapaA = await primeiraEtapa(banco.corretorA);
  etapaB = await primeiraEtapa(banco.corretorB);
});
after(async () => { await banco?.fechar(); });

/** A linha como está no banco (superusuário, sem RLS), no mesmo formato to_jsonb. */
async function linhaNoBanco(tabela: 'clientes' | 'historico_contatos', id: string): Promise<Linha | null> {
  const [r] = await banco.sqlSuperusuario<{ linha: Linha | null }>(
    `select (select to_jsonb(t) from public.${tabela} t where t.id = $1::uuid) as linha`, [id]);
  return r.linha;
}

async function clienteNoBanco(id: string): Promise<Linha> {
  const linha = await linhaNoBanco('clientes', id);
  assert.ok(linha, `o cliente ${id} deveria existir`);
  return linha;
}

async function contar(sql: string, params: unknown[]): Promise<number> {
  return (await banco.sqlSuperusuario<{ n: number }>(`select count(*)::int as n from ${sql}`, params))[0].n;
}

/** Mais recente primeiro, desempate por id: a ordem das listagens do contrato. */
function emOrdem(lista: Linha[], campo: string): boolean {
  return lista.every((atual, i) => {
    if (i === 0) return true;
    const anterior = lista[i - 1];
    const ta = Date.parse(String(anterior[campo]));
    const tb = Date.parse(String(atual[campo]));
    return ta > tb || (ta === tb && String(anterior.id) < String(atual.id));
  });
}

test('claims que não são de usuário autenticado são recusadas pelo TenantDb antes de qualquer SQL', async () => {
  const antes = { ...banco.transacoes };
  await assert.rejects(servico.listar({ sub: USUARIO_A, role: 'anon' }), /claims_invalidas/);
  await assert.rejects(servico.obter({ sub: '', role: 'authenticated' }, INEXISTENTE), /claims_invalidas/);
  assert.deepEqual(banco.transacoes, antes);
});

describe('criar (rpc crm_criar_cliente)', () => {
  test('cria pela RPC e devolve { status: created, cliente_id }; o corretor vem do banco', async () => {
    const dto = {
      nome: '  Maria Silva ', telefone: '(62) 98111-0001', email: 'maria@exemplo.com', cpf: '123.456.789-09',
      tipo_interesse: 'LOCACAO', status_funil: 'VISITA_PROPOSTA', observacoes: 'Prefere visitar à tarde',
      ultimo_contato: '2026-10-01T15:30:00-03:00', tracking_data: { utm_source: 'instagram' },
    } as CriarClienteDto;
    const r = await servico.criar(banco.claimsA, dto) as Linha;
    assert.deepEqual(Object.keys(r).sort(), ['cliente_id', 'status']);
    assert.equal(r.status, 'created');
    assert.match(String(r.cliente_id), V4);
    maria = r.cliente_id as string;

    const linha = await clienteNoBanco(maria);
    assert.deepEqual(
      [linha.corretor_id, linha.nome, linha.telefone, linha.email, linha.cpf, linha.tipo_interesse, linha.status_funil, linha.observacoes],
      [banco.corretorA, 'Maria Silva', '(62) 98111-0001', 'maria@exemplo.com', '123.456.789-09', 'LOCACAO', 'VISITA_PROPOSTA', 'Prefere visitar à tarde'],
    );
    assert.equal(linha.ultimo_contato, '2026-10-01T18:30:00+00:00');
    assert.deepEqual(linha.tracking_data, { utm_source: 'instagram' });
  });

  test('telefone repetido na mesma conta não é erro: 200 { status: duplicate } com o id do dono nos candidatos', async () => {
    const antes = await contar('public.clientes where corretor_id = $1::uuid', [banco.corretorA]);
    const r = await servico.criar(banco.claimsA, { nome: 'Outra Maria', telefone: '+55 62 98111-0001' } as CriarClienteDto);
    assert.deepEqual(r, { status: 'duplicate', candidatos: [{ id: maria, nome: 'Maria Silva', motivo: 'telefone' }] });
    assert.equal(await contar('public.clientes where corretor_id = $1::uuid', [banco.corretorA]), antes);
  });

  test('corrida simulada: o gatilho recusa o telefone e o 409 traz no detalhe o id lido do DETAIL', async () => {
    // A trava 716 impede a corrida de verdade (e o PGlite tem uma conexão só). Um gatilho de teste, que roda antes de
    // clientes_phone_guard_insert, grava o "concorrente" entre a busca da RPC e o insert: o que a outra transação teria feito.
    const VENCEDOR = '44444444-4444-4444-8444-444444444444';
    await banco.pglite.exec(`
      create function public.teste_corrida_cliente() returns trigger language plpgsql as $f$
      begin
        if new.nome = 'Perdeu a corrida' then
          insert into public.clientes (id, corretor_id, nome, telefone) values ('${VENCEDOR}', new.corretor_id, 'Chegou antes', new.telefone);
        end if;
        return new;
      end $f$;
      create trigger a_teste_corrida before insert on public.clientes for each row execute function public.teste_corrida_cliente();`);
    try {
      const erro = await capturarErroHttp(servico.criar(banco.claimsA, { nome: 'Perdeu a corrida', telefone: '62981110004' } as CriarClienteDto));
      assert.deepEqual(erro, corpo(409, 'duplicate_client_phone', 'Este telefone já é de outro cliente do CRM.', { detalhe: VENCEDOR }));
    } finally {
      await banco.pglite.exec('drop trigger a_teste_corrida on public.clientes; drop function public.teste_corrida_cliente();');
    }
    assert.equal(await contar(`public.clientes where id = $1::uuid or nome = 'Perdeu a corrida'`, [VENCEDOR]), 0);
  });

  test('isolamento: o mesmo telefone em outra conta é outro cliente', async () => {
    const r = await servico.criar(banco.claimsB, { nome: 'Maria no B', telefone: '62981110001' } as CriarClienteDto) as Linha;
    assert.equal(r.status, 'created');
    mariaNoB = r.cliente_id as string;
    assert.equal((await clienteNoBanco(mariaNoB)).corretor_id, banco.corretorB);
    assert.equal((await clienteNoBanco(maria)).corretor_id, banco.corretorA);
  });

  test('nome em branco → 422 invalid_name; sem conta → 403 forbidden; enum inválido → 400; nada é gravado', async () => {
    const antes = await contar('public.clientes', []);
    assert.deepEqual(await capturarErroHttp(servico.criar(banco.claimsA, { nome: '   ', telefone: '62981110005' } as CriarClienteDto)),
      corpo(422, 'invalid_name', 'Informe o nome do cliente.'));
    assert.deepEqual(await capturarErroHttp(servico.criar(semConta, { nome: 'Sem conta', telefone: '62981110005' } as CriarClienteDto)), SEM_CONTA);
    // Fora do ValidationPipe: o jsonb_populate_record da RPC recusa (22P02).
    assert.deepEqual(await capturarErroHttp(servico.criar(banco.claimsA,
      { nome: 'Enum ruim', telefone: '62981110005', tipo_interesse: 'PERMUTA' } as CriarClienteDto)), DADOS_INVALIDOS);
    assert.equal(await contar('public.clientes', []), antes);
  });
});

describe('listar', () => {
  test('A vê só os clientes dela, no formato do PostgREST, mais novo primeiro, com cliente_imovel vazio', async () => {
    const lista = await servico.listar(banco.claimsA);
    const ids = (await banco.sqlSuperusuario<{ id: string }>('select id::text as id from public.clientes where corretor_id = $1::uuid', [banco.corretorA])).map((l) => l.id);
    assert.deepEqual(lista.map((c) => c.id).sort(), [...ids].sort());
    assert.ok(lista.length >= 2 && lista.some((c) => c.id === maria) && lista.some((c) => c.id === joao));
    for (const c of lista) {
      assert.deepEqual(Object.keys(c).sort(), [...CHAVES_CLIENTE, 'cliente_imovel'].sort());
      assert.equal(c.corretor_id, banco.corretorA);
      assert.deepEqual(c.cliente_imovel, []);
      assert.match(String(c.created_at), INSTANTE);
      assert.equal(typeof c.is_sample_data, 'boolean');
    }
    assert.ok(emOrdem(lista, 'created_at'), 'ordem: created_at desc, id');
  });

  test('isolamento: B vê só os dele', async () => {
    assert.deepEqual((await servico.listar(banco.claimsB)).map((c) => c.id).sort(), [clienteB, mariaNoB].sort());
  });
});

describe('buscarCandidatos (rpc crm_clientes_por_telefone)', () => {
  test('acha pelo telefone em outro formato, pelo e-mail sem caixa e pelo CPF só com dígitos', async () => {
    const daMaria = (motivo: string) => [{ id: maria, nome: 'Maria Silva', motivo }];
    assert.deepEqual(await servico.buscarCandidatos(banco.claimsA, { telefone: '+55 (62) 98111-0001' }), daMaria('telefone'));
    assert.deepEqual(await servico.buscarCandidatos(banco.claimsA, { email: '  MARIA@Exemplo.com ' }), daMaria('email'));
    assert.deepEqual(await servico.buscarCandidatos(banco.claimsA, { cpf: '12345678909' }), daMaria('cpf'));
    // O mesmo cliente por três motivos sai uma vez, pelo mais forte; clientes diferentes saem por prioridade.
    assert.deepEqual(await servico.buscarCandidatos(banco.claimsA, { telefone: '62981110001', email: 'maria@exemplo.com', cpf: '123.456.789-09' }), daMaria('telefone'));
    assert.deepEqual(await servico.buscarCandidatos(banco.claimsA, { telefone: '62981110003', email: 'maria@exemplo.com' }), [
      { id: joao, nome: 'João Pereira', motivo: 'telefone' }, { id: maria, nome: 'Maria Silva', motivo: 'email' },
    ]);
  });

  test('isolamento: B não acha clientes de A; o mesmo telefone devolve o cliente de B', async () => {
    assert.deepEqual(await servico.buscarCandidatos(banco.claimsB, { email: 'maria@exemplo.com', cpf: '12345678909' }), []);
    assert.deepEqual(await servico.buscarCandidatos(banco.claimsB, { telefone: '62981110001' }), [{ id: mariaNoB, nome: 'Maria no B', motivo: 'telefone' }]);
  });

  test('sem filtro aproveitável → []; sem conta → 403 forbidden', async () => {
    assert.deepEqual(await servico.buscarCandidatos(banco.claimsA, {}), []);
    assert.deepEqual(await servico.buscarCandidatos(banco.claimsA, { cpf: '123', telefone: '' }), []);
    assert.deepEqual(await capturarErroHttp(servico.buscarCandidatos(semConta, { telefone: '62981110001' })), SEM_CONTA);
  });
});

describe('obter', () => {
  test('devolve a linha de public.clientes como o PostgREST: enum em texto, timestamptz com fuso, jsonb objeto', async () => {
    const c = await servico.obter(banco.claimsA, maria);
    assert.deepEqual(Object.keys(c).sort(), CHAVES_CLIENTE);
    assert.deepEqual(c, await clienteNoBanco(maria));
    assert.equal(c.id, maria);
    assert.equal(c.tipo_interesse, 'LOCACAO');
    assert.equal(c.status_funil, 'VISITA_PROPOSTA');
    assert.equal(c.ultimo_contato, '2026-10-01T18:30:00+00:00');
    assert.match(String(c.created_at), INSTANTE);
    assert.match(String(c.updated_at), INSTANTE);
    assert.deepEqual(c.tracking_data, { utm_source: 'instagram' });
    assert.equal(c.is_sample_data, false);
    assert.equal(c.nacionalidade, 'brasileiro(a)');
    assert.equal(c.proximo_followup, null);
  });

  test('isolamento: B não vê o cliente de A → 404; id inexistente → 404', async () => {
    assert.deepEqual(await capturarErroHttp(servico.obter(banco.claimsB, maria)), NAO_ENCONTRADO);
    assert.deepEqual(await capturarErroHttp(servico.obter(banco.claimsA, INEXISTENTE)), NAO_ENCONTRADO);
    assert.equal((await servico.obter(banco.claimsB, clienteB)).id, clienteB);
  });
});

describe('atualizar', () => {
  test('grava só as colunas enviadas da lista de edição e devolve a linha atualizada', async () => {
    const antes = await clienteNoBanco(maria);
    // cpf e corretor_id não estão em COLUNAS_EDICAO_CLIENTE: mesmo chegando ao service, não são gravados.
    const dto = {
      nome: 'Maria Silva Souza', email: null, observacoes: 'Quer 3 quartos', ultimo_contato: '2026-10-02T09:00:00Z',
      cpf: '000.000.000-00', corretor_id: banco.corretorB,
    } as unknown as AtualizarClienteDto;
    const r = await servico.atualizar(banco.claimsA, maria, dto);
    assert.deepEqual(Object.keys(r).sort(), CHAVES_CLIENTE);
    assert.deepEqual(r, await clienteNoBanco(maria));
    assert.deepEqual([r.nome, r.email, r.observacoes, r.ultimo_contato], ['Maria Silva Souza', null, 'Quer 3 quartos', '2026-10-02T09:00:00+00:00']);
    for (const coluna of ['telefone', 'cpf', 'tipo_interesse', 'status_funil', 'corretor_id', 'tracking_data', 'created_at']) {
      assert.deepEqual(r[coluna], antes[coluna], coluna);
    }
  });

  test('nada para gravar → 400 nada_para_atualizar, sem abrir transação', async () => {
    const antes = { ...banco.transacoes };
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, maria, {} as AtualizarClienteDto)),
      corpo(400, 'nada_para_atualizar', 'Nada para atualizar.'));
    assert.deepEqual(banco.transacoes, antes);
  });

  test('telefone de outro cliente da conta → 409 duplicate_client_phone com o id do dono no detalhe', async () => {
    const erro = await capturarErroHttp(servico.atualizar(banco.claimsA, joao, { telefone: '+55 (62) 98111-0001' } as AtualizarClienteDto));
    assert.deepEqual(erro, corpo(409, 'duplicate_client_phone', 'Este telefone já é de outro cliente do CRM.', { detalhe: maria }));
    assert.equal((await clienteNoBanco(joao)).telefone, '62981110003');
  });

  test('isolamento: B não altera cliente de A → 404 e a linha fica igual; id inexistente → 404', async () => {
    const antes = await clienteNoBanco(maria);
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsB, maria, { nome: 'Invadido', telefone: '62991110002' } as AtualizarClienteDto)), NAO_ENCONTRADO);
    assert.deepEqual(await clienteNoBanco(maria), antes);
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, INEXISTENTE, { nome: 'Ninguém' } as AtualizarClienteDto)), NAO_ENCONTRADO);
  });

  test('valor que o banco recusa → 400 dados_invalidos (enum e data)', async () => {
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, maria, { tipo_interesse: 'PERMUTA' } as AtualizarClienteDto)), DADOS_INVALIDOS);
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, maria, { ultimo_contato: 'ontem' } as AtualizarClienteDto)), DADOS_INVALIDOS);
  });

  test('atendimento de suporte vencido → 403 atendimento_expirado e nada é gravado', async () => {
    const sessao = randomUUID();
    await banco.inserir('admin_sessoes_suporte', {
      ator_user_id: USUARIO_B, user_id: USUARIO_A, corretor_id: banco.corretorA, auth_session_id: sessao,
      criado_em: '2026-01-01T00:00:00Z', expira_em: '2026-01-01T00:30:00Z',
    });
    const antes = await clienteNoBanco(maria);
    const erro = await capturarErroHttp(servico.atualizar({ ...banco.claimsA, session_id: sessao }, maria, { observacoes: 'pelo suporte' } as AtualizarClienteDto));
    assert.deepEqual(erro, corpo(403, 'atendimento_expirado', 'Atendimento expirado.'));
    assert.deepEqual(await clienteNoBanco(maria), antes);
  });
});

describe('moverNoFunil', () => {
  test('muda o status (gatilho corrigido pela 20261005020000) e registra o evento na conversa do cliente', async () => {
    const conversa = (await banco.inserir('lotti_agent_conversations', {
      channel_id: randomUUID(), corretor_id: banco.corretorA, cliente_id: maria, phone: '5562981110001',
    }, { semGatilhos: true })).id as string;
    assert.deepEqual(await servico.moverNoFunil(banco.claimsA, maria, { status_funil: 'DOCUMENTACAO' } as MoverClienteDto), { id: maria });
    assert.equal((await clienteNoBanco(maria)).status_funil, 'DOCUMENTACAO');
    const [{ nome: corretora }] = await banco.sqlSuperusuario<{ nome: string }>('select nome from public.corretores where id = $1::uuid', [banco.corretorA]);
    assert.deepEqual(await banco.sqlSuperusuario(
      'select kind, from_label, to_label, actor_label from public.lotti_inbox_events where conversation_id = $1::uuid', [conversa]),
    [{ kind: 'stage', from_label: 'VISITA_PROPOSTA', to_label: 'DOCUMENTACAO', actor_label: corretora }]);

    // Mesmo status de novo: responde { id } e o gatilho não registra outro evento.
    assert.deepEqual(await servico.moverNoFunil(banco.claimsA, maria, { status_funil: 'DOCUMENTACAO' } as MoverClienteDto), { id: maria });
    assert.equal(await contar('public.lotti_inbox_events where conversation_id = $1::uuid', [conversa]), 1);
  });

  test('isolamento: B não move cliente de A → 404 e o status fica; id inexistente → 404', async () => {
    assert.deepEqual(await capturarErroHttp(servico.moverNoFunil(banco.claimsB, maria, { status_funil: 'FECHADO_PERDIDO' } as MoverClienteDto)), NAO_ENCONTRADO);
    assert.equal((await clienteNoBanco(maria)).status_funil, 'DOCUMENTACAO');
    assert.deepEqual(await capturarErroHttp(servico.moverNoFunil(banco.claimsA, INEXISTENTE, { status_funil: 'FECHADO_GANHO' } as MoverClienteDto)), NAO_ENCONTRADO);
    assert.deepEqual(await servico.moverNoFunil(banco.claimsB, clienteB, { status_funil: 'FECHADO_GANHO' } as MoverClienteDto), { id: clienteB });
  });

  test('valor fora do enum → 400 dados_invalidos', async () => {
    assert.deepEqual(await capturarErroHttp(servico.moverNoFunil(banco.claimsA, maria, { status_funil: 'Sem etapa' } as MoverClienteDto)), DADOS_INVALIDOS);
  });
});

describe('definirImovelInteresse', () => {
  const vinculos = async (cliente: string) => (await banco.sqlSuperusuario<{ imovel_id: string }>(
    'select imovel_id::text as imovel_id from public.cliente_imovel where cliente_id = $1::uuid order by imovel_id', [cliente])).map((l) => l.imovel_id);
  const IMOVEL_NAO_ENCONTRADO = corpo(404, 'imovel_nao_encontrado', 'Imóvel não encontrado.');

  test('vincula o imóvel e a listagem mostra o vínculo embutido', async () => {
    assert.deepEqual(await servico.definirImovelInteresse(banco.claimsA, maria, { imovel_id: imovelA1 } as DefinirImovelInteresseDto),
      { cliente_id: maria, imovel_id: imovelA1 });
    assert.deepEqual(await vinculos(maria), [imovelA1]);
    const daLista = (await servico.listar(banco.claimsA)).find((c) => c.id === maria);
    assert.deepEqual(daLista?.cliente_imovel, [{ imovel_id: imovelA1 }]);
  });

  test('trocar substitui o vínculo de uma vez; repetir não duplica', async () => {
    assert.deepEqual(await servico.definirImovelInteresse(banco.claimsA, maria, { imovel_id: imovelA2 } as DefinirImovelInteresseDto),
      { cliente_id: maria, imovel_id: imovelA2 });
    assert.deepEqual(await vinculos(maria), [imovelA2]);
    await servico.definirImovelInteresse(banco.claimsA, maria, { imovel_id: imovelA2 } as DefinirImovelInteresseDto);
    assert.deepEqual(await vinculos(maria), [imovelA2]);
  });

  test('imóvel de outra conta ou inexistente → 404 imovel_nao_encontrado e o vínculo anterior fica', async () => {
    assert.deepEqual(await capturarErroHttp(servico.definirImovelInteresse(banco.claimsA, maria, { imovel_id: imovelB } as DefinirImovelInteresseDto)), IMOVEL_NAO_ENCONTRADO);
    assert.deepEqual(await capturarErroHttp(servico.definirImovelInteresse(banco.claimsA, maria, { imovel_id: INEXISTENTE } as DefinirImovelInteresseDto)), IMOVEL_NAO_ENCONTRADO);
    assert.deepEqual(await vinculos(maria), [imovelA2]);
  });

  test('isolamento: B não mexe no vínculo de cliente de A → 404 cliente_nao_encontrado', async () => {
    assert.deepEqual(await capturarErroHttp(servico.definirImovelInteresse(banco.claimsB, maria, { imovel_id: imovelB } as DefinirImovelInteresseDto)), NAO_ENCONTRADO);
    assert.deepEqual(await capturarErroHttp(servico.definirImovelInteresse(banco.claimsB, maria, { imovel_id: null } as DefinirImovelInteresseDto)), NAO_ENCONTRADO);
    assert.deepEqual(await vinculos(maria), [imovelA2]);
    assert.deepEqual(await capturarErroHttp(servico.definirImovelInteresse(banco.claimsA, INEXISTENTE, { imovel_id: imovelA1 } as DefinirImovelInteresseDto)), NAO_ENCONTRADO);
    // B vincula o próprio imóvel ao próprio cliente.
    assert.deepEqual(await servico.definirImovelInteresse(banco.claimsB, clienteB, { imovel_id: imovelB } as DefinirImovelInteresseDto), { cliente_id: clienteB, imovel_id: imovelB });
    assert.deepEqual(await vinculos(clienteB), [imovelB]);
  });

  test('imovel_id null ou ausente remove o vínculo', async () => {
    assert.deepEqual(await servico.definirImovelInteresse(banco.claimsA, maria, { imovel_id: null } as DefinirImovelInteresseDto), { cliente_id: maria, imovel_id: null });
    assert.deepEqual(await vinculos(maria), []);
    await servico.definirImovelInteresse(banco.claimsA, maria, { imovel_id: imovelA1 } as DefinirImovelInteresseDto);
    assert.deepEqual(await servico.definirImovelInteresse(banco.claimsA, maria, {} as DefinirImovelInteresseDto), { cliente_id: maria, imovel_id: null });
    assert.deepEqual(await vinculos(maria), []);
  });
});

describe('completarCpf', () => {
  const cpfDe = async (id: string) => (await clienteNoBanco(id)).cpf;

  test('isolamento: B não preenche o CPF de cliente de A → { atualizado: false } e nada muda', async () => {
    assert.deepEqual(await servico.completarCpf(banco.claimsB, joao, { cpf: '11122233344' }), { atualizado: false });
    assert.equal(await cpfDe(joao), null);
  });

  test('preenche CPF nulo; já preenchido ou inexistente → { atualizado: false } sem 404 e sem sobrescrever', async () => {
    assert.deepEqual(await servico.completarCpf(banco.claimsA, joao, { cpf: '11122233344' }), { atualizado: true });
    assert.equal(await cpfDe(joao), '11122233344');
    assert.deepEqual(await servico.completarCpf(banco.claimsA, joao, { cpf: '55566677788' }), { atualizado: false });
    assert.equal(await cpfDe(joao), '11122233344');
    assert.deepEqual(await servico.completarCpf(banco.claimsA, maria, { cpf: '55566677788' }), { atualizado: false });
    assert.equal(await cpfDe(maria), '123.456.789-09');
    assert.deepEqual(await servico.completarCpf(banco.claimsA, INEXISTENTE, { cpf: '55566677788' }), { atualizado: false });
  });
});

describe('histórico (registrarHistorico e listarHistorico)', () => {
  const SEM_PERMISSAO = corpo(403, 'sem_permissao', 'Sua conta não tem permissão para registrar contatos deste cliente.');
  let primeiro: Linha;

  test('o dono grava (policy de INSERT da 20261005020000) e a resposta é igual à linha gravada', async () => {
    const r = await servico.registrarHistorico(banco.claimsA, maria,
      { tipo: 'WHATSAPP', conteudo: 'Pediu fotos da cozinha', metadata: { origem: 'teste', tentativas: 2 } } as RegistrarHistoricoDto);
    assert.deepEqual(Object.keys(r).sort(), CHAVES_HISTORICO);
    assert.match(String(r.id), V4);
    assert.deepEqual([r.cliente_id, r.tipo, r.direcao, r.conteudo], [maria, 'WHATSAPP', 'OUT', 'Pediu fotos da cozinha']);
    assert.deepEqual(r.metadata, { origem: 'teste', tentativas: 2 });
    assert.match(String(r.data_contato), INSTANTE);
    assert.equal(r.created_at, r.data_contato);
    // now() da resposta é o mesmo instante dos defaults: a resposta é a linha gravada, no formato do to_jsonb.
    assert.deepEqual(r, await linhaNoBanco('historico_contatos', String(r.id)));
    primeiro = r;
  });

  test('listar devolve o histórico do cliente, mais recente primeiro, no mesmo formato', async () => {
    const segundo = await servico.registrarHistorico(banco.claimsA, maria, { tipo: 'EMAIL', direcao: 'IN', conteudo: '' } as RegistrarHistoricoDto);
    assert.deepEqual([segundo.direcao, segundo.conteudo, segundo.metadata], ['IN', '', {}]);
    const lista = await servico.listarHistorico(banco.claimsA, maria);
    assert.equal(lista.length, 2);
    assert.ok(emOrdem(lista, 'data_contato'), 'ordem: data_contato desc, id');
    assert.deepEqual([...lista].sort((x, y) => String(x.id).localeCompare(String(y.id))),
      [primeiro, segundo].sort((x, y) => String(x.id).localeCompare(String(y.id))));
    for (const h of lista) assert.deepEqual(Object.keys(h).sort(), CHAVES_HISTORICO);
  });

  test('isolamento: B não grava no cliente de A → 403 sem_permissao, e não lê → []', async () => {
    assert.deepEqual(await capturarErroHttp(servico.registrarHistorico(banco.claimsB, maria, { tipo: 'WHATSAPP', conteudo: 'invasão' } as RegistrarHistoricoDto)), SEM_PERMISSAO);
    assert.deepEqual(await servico.listarHistorico(banco.claimsB, maria), []);
    assert.equal(await contar('public.historico_contatos where cliente_id = $1::uuid', [maria]), 2);
  });

  test('cliente inexistente: gravar → 403 (o RLS confere antes da FK); listar → []', async () => {
    assert.deepEqual(await capturarErroHttp(servico.registrarHistorico(banco.claimsA, INEXISTENTE, { tipo: 'OUTRO', conteudo: 'x' } as RegistrarHistoricoDto)), SEM_PERMISSAO);
    assert.deepEqual(await servico.listarHistorico(banco.claimsA, INEXISTENTE), []);
  });

  test('B grava e lê no próprio cliente; A não vê', async () => {
    const r = await servico.registrarHistorico(banco.claimsB, clienteB, { tipo: 'PRESENCIAL', conteudo: 'Visitou a casa' } as RegistrarHistoricoDto);
    assert.deepEqual(await servico.listarHistorico(banco.claimsB, clienteB), [r]);
    assert.deepEqual(await servico.listarHistorico(banco.claimsA, clienteB), []);
  });

  test('canal fora do enum → 400 dados_invalidos', async () => {
    assert.deepEqual(await capturarErroHttp(servico.registrarHistorico(banco.claimsA, maria, { tipo: 'SMS', conteudo: 'x' } as RegistrarHistoricoDto)), DADOS_INVALIDOS);
  });
});

describe('converterLead (rpc crm_converter_lead)', () => {
  const FORBIDDEN = corpo(403, 'forbidden', 'Este lead não é de uma fachada sua, ou o cliente escolhido é de outra conta.');
  let leadNovo: string;
  let leadRepetido: string;
  let leadEditado: string;
  let leadPendente: string;
  let leadDoB: string;

  const situacao = async (lead: string) => (await banco.sqlSuperusuario<{ convertido: boolean; cliente_id: string | null }>(
    'select convertido, cliente_id::text as cliente_id from public.fachada_leads where id = $1::uuid', [lead]))[0];

  before(async () => {
    // Fachadas e leads entram sem gatilhos: a trava de cota de fachadas e o limite de pedidos públicos não são o assunto aqui.
    const fachada = async (corretor_id: string, imovel_id: string) =>
      (await banco.inserir('fachadas', { corretor_id, imovel_id }, { semGatilhos: true })).id as string;
    const lead = async (fachada_id: string, nome: string, telefone: string, email?: string) =>
      (await banco.inserir('fachada_leads', { fachada_id, nome, telefone, email }, { semGatilhos: true })).id as string;
    const fachadaA = await fachada(banco.corretorA, imovelA1);
    const fachadaB = await fachada(banco.corretorB, imovelB);
    leadNovo = await lead(fachadaA, 'Lead Novo', '62981110010', 'lead.novo@exemplo.com');
    leadRepetido = await lead(fachadaA, 'Lead Repetido', '(62) 98111-0003'); // telefone do João
    leadEditado = await lead(fachadaA, 'Lead Antigo', '62981110012');
    leadPendente = await lead(fachadaA, 'Lead Pendente', '62981110015');
    leadDoB = await lead(fachadaB, 'Lead do B', '62991110013');
  });

  test('lead novo sem etapa: cria o cliente e marca o lead → converted, created: true, sem negócio', async () => {
    const r = await servico.converterLead(banco.claimsA, { lead_id: leadNovo } as ConverterLeadDto) as Linha;
    assert.deepEqual(Object.keys(r).sort(), ['cliente_id', 'created', 'oportunidade_id', 'status']);
    assert.deepEqual([r.status, r.created, r.oportunidade_id], ['converted', true, null]);
    assert.match(String(r.cliente_id), V4);
    assert.deepEqual(await situacao(leadNovo), { convertido: true, cliente_id: r.cliente_id });
    const c = await clienteNoBanco(String(r.cliente_id));
    assert.deepEqual(
      [c.corretor_id, c.nome, c.telefone, c.email, c.tipo_interesse, c.status_funil, c.observacoes],
      [banco.corretorA, 'Lead Novo', '62981110010', 'lead.novo@exemplo.com', 'COMPRA', 'QUALIFICACAO', 'Convertido de lead da fachada.'],
    );

    // De novo: ja_convertido com o mesmo cliente, sem criar outro.
    assert.deepEqual(await servico.converterLead(banco.claimsA, { lead_id: leadNovo } as ConverterLeadDto), { status: 'ja_convertido', cliente_id: r.cliente_id });
  });

  test('telefone de cliente existente → duplicate com os candidatos; o lead continua pendente', async () => {
    assert.deepEqual(await servico.converterLead(banco.claimsA, { lead_id: leadRepetido } as ConverterLeadDto),
      { status: 'duplicate', candidatos: [{ id: joao, nome: 'João Pereira', motivo: 'telefone' }] });
    assert.deepEqual(await situacao(leadRepetido), { convertido: false, cliente_id: null });
  });

  test('escolhendo o cliente existente e uma etapa → converted, created: false, negócio aberto na etapa', async () => {
    const r = await servico.converterLead(banco.claimsA, { lead_id: leadRepetido, cliente_id: joao, etapa_id: etapaA } as ConverterLeadDto) as Linha;
    assert.deepEqual([r.status, r.cliente_id, r.created], ['converted', joao, false]);
    assert.match(String(r.oportunidade_id), V4);
    assert.deepEqual(await banco.sqlSuperusuario(
      'select corretor_id::text as corretor_id, cliente_id::text as cliente_id, etapa_id::text as etapa_id, titulo, origem from public.crm_oportunidades where id = $1::uuid',
      [r.oportunidade_id]), [{ corretor_id: banco.corretorA, cliente_id: joao, etapa_id: etapaA, titulo: 'Lead Repetido', origem: 'fachada' }]);
    assert.deepEqual(await situacao(leadRepetido), { convertido: true, cliente_id: joao });
  });

  test('nome, telefone e e-mail editados na tela valem sobre os do lead', async () => {
    const r = await servico.converterLead(banco.claimsA,
      { lead_id: leadEditado, nome: 'Nome Editado', telefone: '62981110014', email: 'editado@exemplo.com' } as ConverterLeadDto) as Linha;
    assert.deepEqual([r.status, r.created], ['converted', true]);
    const c = await clienteNoBanco(String(r.cliente_id));
    assert.deepEqual([c.nome, c.telefone, c.email], ['Nome Editado', '62981110014', 'editado@exemplo.com']);
  });

  test('etapa de outra conta → 422 invalid_stage e nada muda', async () => {
    const antes = await contar('public.clientes', []);
    assert.deepEqual(await capturarErroHttp(servico.converterLead(banco.claimsA, { lead_id: leadPendente, etapa_id: etapaB } as ConverterLeadDto)),
      corpo(422, 'invalid_stage', 'A etapa do pipeline não existe mais. Recarregue a página e tente de novo.'));
    assert.deepEqual(await situacao(leadPendente), { convertido: false, cliente_id: null });
    assert.equal(await contar('public.clientes', []), antes);
  });

  test('isolamento: lead de outra conta, cliente de outra conta, lead inexistente ou sem conta → 403 forbidden', async () => {
    assert.deepEqual(await capturarErroHttp(servico.converterLead(banco.claimsB, { lead_id: leadPendente } as ConverterLeadDto)), FORBIDDEN);
    assert.deepEqual(await capturarErroHttp(servico.converterLead(banco.claimsA, { lead_id: leadPendente, cliente_id: clienteB } as ConverterLeadDto)), FORBIDDEN);
    assert.deepEqual(await capturarErroHttp(servico.converterLead(banco.claimsA, { lead_id: leadDoB } as ConverterLeadDto)), FORBIDDEN);
    assert.deepEqual(await capturarErroHttp(servico.converterLead(banco.claimsA, { lead_id: INEXISTENTE } as ConverterLeadDto)), FORBIDDEN);
    assert.deepEqual(await capturarErroHttp(servico.converterLead(semConta, { lead_id: leadPendente } as ConverterLeadDto)), FORBIDDEN);
    assert.deepEqual(await situacao(leadPendente), { convertido: false, cliente_id: null });
    assert.deepEqual(await situacao(leadDoB), { convertido: false, cliente_id: null });
  });
});

describe('remover', () => {
  const NADA_APAGADO = corpo(404, 'cliente_nao_encontrado', 'Nada foi apagado: o cliente não existe ou você não tem permissão.');

  test('isolamento: B não apaga cliente de A → 404 "Nada foi apagado"; id inexistente → 404', async () => {
    assert.deepEqual(await capturarErroHttp(servico.remover(banco.claimsB, maria)), NADA_APAGADO);
    await clienteNoBanco(maria);
    assert.deepEqual(await capturarErroHttp(servico.remover(banco.claimsA, INEXISTENTE)), NADA_APAGADO);
  });

  test('cliente com contrato → 409 cliente_com_contrato (sqlstate 23503) e nada é apagado', async () => {
    // Sem gatilhos: a trava de cota de contratos não é o assunto. A FK (ON DELETE RESTRICT) vale no delete.
    await banco.inserir('contratos', {
      corretor_id: banco.corretorA, cliente_id: joao, tipo: 'COMPRA_VENDA', valor: 350000, data_inicio: '2026-10-01', conteudo: 'Contrato de teste',
    }, { semGatilhos: true });
    assert.deepEqual(await capturarErroHttp(servico.remover(banco.claimsA, joao)),
      corpo(409, 'cliente_com_contrato', 'Existem contratos vinculados a este cliente.', { sqlstate: '23503' }));
    await clienteNoBanco(joao);
  });

  test('apaga o cliente e leva junto histórico e vínculo de imóvel; a conversa fica sem cliente', async () => {
    await servico.definirImovelInteresse(banco.claimsA, maria, { imovel_id: imovelA1 } as DefinirImovelInteresseDto);
    assert.equal(await servico.remover(banco.claimsA, maria), undefined);
    assert.equal(await linhaNoBanco('clientes', maria), null);
    assert.deepEqual(await capturarErroHttp(servico.obter(banco.claimsA, maria)), NAO_ENCONTRADO);
    assert.equal(await contar('public.historico_contatos where cliente_id = $1::uuid', [maria]), 0);
    assert.equal(await contar('public.cliente_imovel where cliente_id = $1::uuid', [maria]), 0);
    assert.equal(await contar('public.lotti_agent_conversations where cliente_id = $1::uuid', [maria]), 0);
    assert.equal(await contar('public.lotti_agent_conversations where corretor_id = $1::uuid and cliente_id is null', [banco.corretorA]), 1);
    // O cliente de B com o mesmo telefone continua lá.
    await clienteNoBanco(mariaNoB);
  });
});

test('nenhum run terminou com a transação abortada (erro de banco engolido dentro do run)', () => {
  assert.equal(banco.transacoes.commitsAbortados, 0);
  assert.ok(banco.transacoes.commits > 0 && banco.transacoes.rollbacks > 0);
});
