/**
 * Bloco B0 (base da virada) contra o schema REAL (PGlite com todas as migrations):
 *  - cadastro pela API: auth.users + public.usuarios numa transação, o gatilho de sempre cria o
 *    corretor (e get_corretor_id resolve), e o login seguinte com a mesma senha funciona;
 *  - perfil: GET devolve a linha do próprio usuário e o corretor da conta, PATCH só mexe na própria
 *    linha (RLS), registrar_atividade grava o evento;
 *  - histórico sem cliente respeita o RLS;
 *  - leads pendentes (convertido=false) das fachadas.
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../../src/auth/auth.service';
import type { AtualizarCorretorDto } from '../../src/auth/perfil.dto';
import { PerfilService } from '../../src/auth/perfil.service';
import { UsuariosRepo } from '../../src/auth/usuarios.repo';
import type { AppEnv } from '../../src/config/env';
import { CrmClientesService } from '../../src/crm/clientes/crm-clientes.service';
import { FachadasLeadsService } from '../../src/fachadas/fachadas-leads.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SupabaseClaims } from '../../src/prisma/tenant-db';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

const env: AppEnv = {
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x', corsOrigins: [],
  authJwtSecret: 'segredo-de-teste-com-mais-de-32-caracteres!!', authAccessTtl: 900, authRefreshTtl: 2592000,
  authIssuer: 'lotti-api', emailHabilitado: false,
};

let banco: BancoTeste;
let repo: UsuariosRepo;
let auth: AuthService;
let perfil: PerfilService;

before(async () => {
  banco = await criarBanco();
  repo = new UsuariosRepo(banco.prisma as unknown as PrismaService);
  auth = new AuthService(env, repo);
  perfil = new PerfilService(banco.db);
});

after(async () => { await banco.fechar(); });

describe('cadastro pela API', () => {
  const dados = { email: ' Nova.Corretora@Exemplo.com ', senha: 'senha-nova-1', nome: 'Nova Corretora', cnpj: '11.222.333/0001-81', telefone: '(62) 99999-0000' };
  let userId = '';

  test('cria auth.users + usuarios com o mesmo id e bcrypt, e o gatilho cria o corretor', async () => {
    const sessao = await auth.cadastrar(dados, '203.0.113.9');
    assert.equal(sessao.accessToken.split('.').length, 3);

    const [usuario] = await banco.sqlSuperusuario<{ id: string; email: string; password_hash: string; status: string }>(
      `select id::text as id, email, password_hash, status from public.usuarios where email = 'nova.corretora@exemplo.com'`);
    assert.ok(usuario, 'public.usuarios precisa ter a conta');
    userId = usuario.id;
    assert.equal(usuario.status, 'ativo');
    assert.match(usuario.password_hash, /^\$2[aby]\$10\$/);

    const [authUser] = await banco.sqlSuperusuario<{ email: string; encrypted_password: string; aud: string; role: string; confirmado: boolean; meta: Record<string, unknown> }>(
      `select email, encrypted_password, aud, role, email_confirmed_at is not null as confirmado, raw_user_meta_data as meta
         from auth.users where id = $1::uuid`, [userId]);
    assert.equal(authUser.email, 'nova.corretora@exemplo.com');
    assert.equal(authUser.encrypted_password, usuario.password_hash, 'o mesmo bcrypt nas duas tabelas');
    assert.equal(authUser.aud, 'authenticated');
    assert.equal(authUser.role, 'authenticated');
    assert.equal(authUser.confirmado, true);
    assert.deepEqual(authUser.meta, { nome: 'Nova Corretora', cnpj: '11.222.333/0001-81', creci: 'PENDENTE', telefone: '(62) 99999-0000' });

    const [corretor] = await banco.sqlSuperusuario<{ id: string; nome: string; email: string; telefone: string; cnpj_cpf: string; creci: string }>(
      'select id::text as id, nome, email, telefone, cnpj_cpf, creci from public.corretores where user_id = $1::uuid', [userId]);
    assert.ok(corretor, 'handle_new_user precisa ter criado o corretor');
    assert.equal(corretor.nome, 'Nova Corretora');
    assert.equal(corretor.email, 'nova.corretora@exemplo.com');
    assert.equal(corretor.cnpj_cpf, '11.222.333/0001-81');
    assert.equal(corretor.creci, 'PENDENTE');

    // A conta nova trabalha na própria conta: get_corretor_id() e as etapas do funil existem.
    const claims: SupabaseClaims = { sub: userId, role: 'authenticated', email: 'nova.corretora@exemplo.com' };
    const p = await perfil.obter(claims);
    assert.equal(p.corretor_id, corretor.id);
    const [{ n }] = await banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from public.crm_etapas where corretor_id = $1::uuid', [corretor.id]);
    assert.ok(n > 0, 'as etapas do funil vêm dos gatilhos do corretor');
  });

  test('o login seguinte com a mesma senha funciona; senha errada não', async () => {
    const sessao = await auth.login('NOVA.CORRETORA@exemplo.com', 'senha-nova-1');
    assert.equal(sessao.accessToken.split('.').length, 3);
    const erro = await capturarErroHttp(auth.login('nova.corretora@exemplo.com', 'outra-senha'));
    assert.equal(erro.status, 401);
  });

  test('e-mail repetido (qualquer caixa) dá 409 e não cria nada', async () => {
    const antes = await banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from auth.users');
    const erro = await capturarErroHttp(auth.cadastrar({ ...dados, email: 'NOVA.corretora@EXEMPLO.com' }, '203.0.113.10'));
    assert.equal(erro.status, 409);
    assert.equal(erro.corpo.codigo, 'email_em_uso');
    const depois = await banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from auth.users');
    assert.equal(depois[0].n, antes[0].n);
  });

  test('e-mail de conta antiga (só em auth.users, ainda sem usuarios) também dá 409', async () => {
    const erro = await capturarErroHttp(auth.cadastrar({ ...dados, email: banco.contaA.email.toUpperCase() }, '203.0.113.11'));
    assert.equal(erro.status, 409);
  });

  test('o limite por IP recusa com 429 e conta mesmo quando o cadastro falha', async () => {
    const ip = '198.51.100.77';
    for (let i = 0; i < 10; i += 1) {
      // repetido de propósito: falha com 409, mas consome o limite
      await capturarErroHttp(auth.cadastrar(dados, ip));
    }
    const erro = await capturarErroHttp(auth.cadastrar({ ...dados, email: `limite-${randomUUID()}@exemplo.com` }, ip));
    assert.equal(erro.status, 429);
    // a tabela de limites nunca guarda o IP cru
    const linhas = await banco.sqlSuperusuario<{ subject_hash: string }>(
      `select subject_hash from public.public_request_limits where scope = 'auth-cadastro-ip'`);
    assert.ok(linhas.length > 0);
    assert.ok(linhas.every((l) => !l.subject_hash.includes(ip)));
  });
});

describe('perfil do corretor', () => {
  test('GET devolve a própria linha e o corretor da conta', async () => {
    const p = await perfil.obter(banco.claimsA);
    assert.equal((p.corretor as Record<string, unknown>).id, banco.corretorA);
    assert.equal((p.corretor as Record<string, unknown>).user_id, banco.contaA.userId);
    assert.equal(p.corretor_id, banco.corretorA);
  });

  test('sem corretor nenhum: corretor e corretor_id nulos, sem erro', async () => {
    const p = await perfil.obter({ sub: randomUUID(), role: 'authenticated' });
    assert.deepEqual(p, { corretor: null, corretor_id: null });
  });

  test('PATCH grava só as colunas enviadas na própria linha; a de B fica intacta', async () => {
    const antesB = await banco.sqlSuperusuario<{ nome: string }>('select nome from public.corretores where id = $1::uuid', [banco.corretorB]);
    const linha = await perfil.atualizar(banco.claimsA, {
      nome: 'Corretora A Editada', telefone: '(62) 98888-7777', creci_estado: 'GO', website: '', foto_url: 'data:image/png;base64,AAAA',
    } as AtualizarCorretorDto);
    assert.equal(linha.nome, 'Corretora A Editada');
    assert.equal(linha.creci_estado, 'GO');
    assert.equal(linha.foto_url, 'data:image/png;base64,AAAA');
    const [noBanco] = await banco.sqlSuperusuario<{ nome: string; telefone: string; status: string }>(
      'select nome, telefone, status from public.corretores where id = $1::uuid', [banco.corretorA]);
    assert.equal(noBanco.nome, 'Corretora A Editada');
    assert.equal(noBanco.telefone, '(62) 98888-7777');
    assert.equal(noBanco.status, 'ativo');
    const depoisB = await banco.sqlSuperusuario<{ nome: string }>('select nome from public.corretores where id = $1::uuid', [banco.corretorB]);
    assert.deepEqual(depoisB, antesB);
  });

  test('PATCH sem nada para gravar dá 400; usuário sem corretor dá 404', async () => {
    assert.equal((await capturarErroHttp(perfil.atualizar(banco.claimsA, {} as AtualizarCorretorDto))).status, 400);
    const erro = await capturarErroHttp(perfil.atualizar({ sub: randomUUID(), role: 'authenticated' }, { nome: 'X' } as AtualizarCorretorDto));
    assert.equal(erro.status, 404);
  });

  test('registrar atividade grava o evento e o último acesso do corretor', async () => {
    await perfil.registrarAtividade(banco.claimsB, { tipo: 'login', rota: '/inicio' });
    const eventos = await banco.sqlSuperusuario<{ tipo: string; rota: string; corretor_id: string }>(
      'select tipo, rota, corretor_id::text as corretor_id from public.atividade_eventos where user_id = $1::uuid', [banco.contaB.userId]);
    assert.deepEqual(eventos, [{ tipo: 'login', rota: '/inicio', corretor_id: banco.corretorB }]);
    const [c] = await banco.sqlSuperusuario<{ acesso: boolean }>(
      'select ultimo_acesso_em is not null as acesso from public.corretores where id = $1::uuid', [banco.corretorB]);
    assert.equal(c.acesso, true);
  });
});

describe('histórico sem cliente e leads pendentes', () => {
  test('o histórico geral traz só o que o RLS deixa ver, mais recente primeiro', async () => {
    const clienteA = (await banco.inserir('clientes', { corretor_id: banco.corretorA, nome: 'Ana Histórico', telefone: '62981119901' })).id as string;
    const clienteB = (await banco.inserir('clientes', { corretor_id: banco.corretorB, nome: 'Bia Histórico', telefone: '62981119902' })).id as string;
    await banco.inserir('historico_contatos', { cliente_id: clienteA, direcao: 'OUT', conteudo: 'antigo', data_contato: '2026-10-01T10:00:00Z' });
    await banco.inserir('historico_contatos', { cliente_id: clienteA, direcao: 'IN', conteudo: 'novo', data_contato: '2026-10-05T10:00:00Z' });
    await banco.inserir('historico_contatos', { cliente_id: clienteB, direcao: 'OUT', conteudo: 'do B', data_contato: '2026-10-06T10:00:00Z' });

    const linhas = await new CrmClientesService(banco.db).listarHistoricoGeral(banco.claimsA);
    assert.deepEqual(linhas.map((l) => l.conteudo), ['novo', 'antigo']);
  });

  test('convertido=false lista só os pendentes da própria conta', async () => {
    const imovel = (await banco.inserir('imoveis', {
      corretor_id: banco.corretorA, titulo: 'Casa da placa', tipo: 'CASA', valor: 1, endereco: 'Rua 1', cidade: 'Anápolis', proprietario_nome: 'Dono',
    })).id as string;
    const fachada = (await banco.inserir('fachadas', {
      corretor_id: banco.corretorA, imovel_id: imovel, tipo_negocio: 'VENDA', template_id: 't', cta_principal: 'WHATSAPP', modo_conversao: false,
    }, { semGatilhos: true })).id as string;
    await banco.inserir('fachada_leads', { fachada_id: fachada, nome: 'Pendente', telefone: '62970000001', convertido: false }, { semGatilhos: true });
    await banco.inserir('fachada_leads', { fachada_id: fachada, nome: 'Convertido', telefone: '62970000002', convertido: true }, { semGatilhos: true });

    const leads = new FachadasLeadsService(banco.db);
    const pendentes = await leads.listar(banco.claimsA, { convertido: false });
    assert.deepEqual(pendentes.map((l) => l.nome), ['Pendente']);
    const todos = await leads.listar(banco.claimsA, {});
    assert.deepEqual(todos.map((l) => l.nome).sort(), ['Convertido', 'Pendente']);
    assert.deepEqual(await leads.listar(banco.claimsB, { convertido: false }), []);
  });
});
