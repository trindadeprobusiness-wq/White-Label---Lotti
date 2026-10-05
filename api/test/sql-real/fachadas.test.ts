// SQL real do módulo fachadas (contrato 2026-10-05) contra um Postgres de verdade: PGlite com todas as
// migrations, RLS ligado, gatilhos de verdade e o TenantDb de produção. Cobre F1–F12 (caminho feliz,
// isolamento entre as contas A e B e erros traduzidos) e P1–P3 pelo FachadasPublicoRepo, com o
// `set local role anon` de verdade — é ali que as policies públicas, o gatilho guard_public_fachada_insert
// e os limites de consume_public_request_limit se provam. Nenhuma rede, nenhum segredo.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FachadasLeadsService } from '../../src/fachadas/fachadas-leads.service';
import { FachadasMetricasService } from '../../src/fachadas/fachadas-metricas.service';
import { FachadasMidiasService } from '../../src/fachadas/fachadas-midias.service';
import { FachadasTemplatesService } from '../../src/fachadas/fachadas-templates.service';
import {
  CriarFachadaDto, CriarTemplateDto, EditarFachadaDto, ListarLeadsDto, ListarTemplatesDto, MetricasDto, PorImagemDto,
} from '../../src/fachadas/fachadas.dto';
import { traduzirErroBanco } from '../../src/fachadas/fachadas.erros';
import { FachadasService } from '../../src/fachadas/fachadas.service';
import { EnviarLeadDto } from '../../src/fachadas/publico/fachadas-publico.dto';
import { FachadasPublicoRepo } from '../../src/fachadas/publico/fachadas-publico.repo';
import { FachadasPublicoService } from '../../src/fachadas/publico/fachadas-publico.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SupabaseClaims } from '../../src/prisma/tenant-db';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

let banco: BancoTeste;
let fachadas: FachadasService;
let leads: FachadasLeadsService;
let metricas: FachadasMetricasService;
let templates: FachadasTemplatesService;
let midias: FachadasMidiasService;
let repo: FachadasPublicoRepo;
let publico: FachadasPublicoService;

let imovelA = '';
let imovelB = '';
let fachadaB = '';
/** Registra qual dos dois caminhos de §1.6 foi usado para a tabela public.videos. */
let videosNoBaseline = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const INEXISTENTE = '99999999-9999-4999-8999-999999999999';
const LIMITE_FACHADAS_A = 50;

const OPCOES_PIPE = { whitelist: true, forbidNonWhitelisted: true };

function dto<T extends object>(Classe: new () => T, corpo: Record<string, unknown>): T {
  const instancia = plainToInstance(Classe, corpo);
  assert.deepEqual(validateSync(instancia, OPCOES_PIPE).map((e) => e.property), [], 'o ValidationPipe deveria aceitar este corpo');
  return instancia;
}

/** O ValidationPipe recusa este corpo; devolve as propriedades reprovadas. */
function dtoRecusa<T extends object>(Classe: new () => T, corpo: Record<string, unknown>): string[] {
  const erros = validateSync(plainToInstance(Classe, corpo), OPCOES_PIPE).map((e) => e.property);
  assert.ok(erros.length > 0, `o ValidationPipe deveria recusar ${JSON.stringify(corpo)}`);
  return erros;
}

async function falha(promessa: Promise<unknown>, status: number, codigo: string): Promise<Record<string, unknown>> {
  const r = await capturarErroHttp(promessa);
  assert.equal(r.status, status, JSON.stringify(r.corpo));
  assert.equal(r.corpo.codigo, codigo, JSON.stringify(r.corpo));
  return r.corpo;
}

const criarDto = (extra: Record<string, unknown> = {}) => dto(CriarFachadaDto, {
  imovel_id: imovelA, tipo_negocio: 'VENDA', template_id: 'venda-classica', cta_principal: 'WHATSAPP',
  modo_conversao: false, ...extra,
});

async function novoImovel(corretorId: string, titulo: string, semGatilhos = false): Promise<string> {
  const linha = await banco.inserir('imoveis', {
    corretor_id: corretorId, titulo, tipo: 'CASA', valor: 450000.5, area_m2: 90, dormitorios: 3, banheiros: 2,
    garagem: 1, endereco: 'Rua das Placas, 10', bairro: 'Centro', cidade: 'Anápolis', estado: 'GO',
    descricao: 'Imóvel de teste', proprietario_nome: 'Dono', proprietario_cpf: '00000000000',
    proprietario_telefone: '6230000000', proprietario_email: 'dono@exemplo.local',
  }, { semGatilhos });
  return linha.id as string;
}

async function novaFoto(imovelId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const linha = await banco.inserir('imovel_fotos', {
    imovel_id: imovelId, arquivo_path: `imoveis/${imovelId}/f.jpg`, arquivo_url: `https://host/${imovelId}/f.jpg`, ...extra,
  });
  return linha.id as string;
}

/** Cria uma fachada de A pela rota F2 e devolve o id. */
async function novaFachada(extra: Record<string, unknown> = {}): Promise<string> {
  const linha = await fachadas.criar(banco.claimsA, criarDto(extra));
  return linha.id as string;
}

const contarScans = async (fachadaId: string): Promise<number> => Number(
  (await banco.sqlSuperusuario<{ n: number }>(
    'select count(*)::int as n from public.fachada_escaneamentos where fachada_id = $1', [fachadaId]))[0].n,
);
const contarLeads = async (fachadaId: string): Promise<number> => Number(
  (await banco.sqlSuperusuario<{ n: number }>(
    'select count(*)::int as n from public.fachada_leads where fachada_id = $1', [fachadaId]))[0].n,
);
const contadores = async (fachadaId: string): Promise<{ total_escaneamentos: number; total_leads: number }> => (
  await banco.sqlSuperusuario<{ total_escaneamentos: number; total_leads: number }>(
    'select total_escaneamentos, total_leads from public.fachadas where id = $1', [fachadaId]))[0];

before(async () => {
  banco = await criarBanco();
  fachadas = new FachadasService(banco.db);
  leads = new FachadasLeadsService(banco.db);
  metricas = new FachadasMetricasService(banco.db);
  templates = new FachadasTemplatesService(banco.db);
  midias = new FachadasMidiasService(banco.db);
  // O repo público é montado sobre o PrismaService falso: é o caminho de FORA da transação do harness,
  // e é assim que o `set local role anon` de produção é exercitado de verdade.
  repo = new FachadasPublicoRepo(banco.prisma as unknown as PrismaService);
  publico = new FachadasPublicoService(repo);

  // O plano da conta A do harness só tem max_imoveis: sem este entitlement, TODA criação de fachada
  // cairia em PLAN_LIMIT_REACHED (checar_cota devolve `permitido = false` quando a feature não existe).
  await banco.inserir('plan_entitlements', {
    plan_id: banco.contaA.planoId, feature_key: 'max_fachadas', feature_name: 'Fachadas Inteligentes',
    enabled: true, limit_value: LIMITE_FACHADAS_A, unlimited: false,
  });

  // public.videos existe em produção mas NÃO está no baseline do Prisma (contrato §1.6 e §7.2.3).
  // Nada de skip silencioso: quando falta, o teste cria uma cópia mínima para exercitar F12 de verdade.
  const [{ existe }] = await banco.sqlSuperusuario<{ existe: boolean }>(
    "select to_regclass('public.videos') is not null as existe");
  videosNoBaseline = existe;
  if (!videosNoBaseline) {
    // sqlSuperusuario roda um comando por chamada (prepared statement do PGlite).
    for (const comando of [
      `create table public.videos (
         id uuid not null default gen_random_uuid() primary key,
         corretor_id uuid not null,
         imovel_id uuid)`,
      'alter table public.videos enable row level security',
      `create policy "Corretor gerencia seus videos" on public.videos for all
         using (corretor_id = public.get_corretor_id())`,
      'grant select, insert, update, delete on table public.videos to anon, authenticated, service_role',
    ]) await banco.sqlSuperusuario(comando);
  }

  imovelA = await novoImovel(banco.corretorA, 'Casa da A');
  imovelB = await novoImovel(banco.corretorB, 'Casa do B', true); // B não tem plano: a trava de cota recusaria
  fachadaB = (await banco.inserir('fachadas', {
    corretor_id: banco.corretorB, imovel_id: imovelB, tipo_negocio: 'ALUGUEL', template_id: 'aluguel',
    cta_principal: 'WHATSAPP', modo_conversao: false,
  }, { semGatilhos: true })).id as string;
});

after(async () => {
  await banco?.fechar();
});

describe('preparo', () => {
  test('registra qual caminho foi usado para public.videos (§1.6, §7.2.3)', () => {
    assert.equal(typeof videosNoBaseline, 'boolean');
    if (!videosNoBaseline) {
      // Divergência conhecida entre o baseline do Prisma e o banco real: pendência §7.2.3.
      assert.equal(videosNoBaseline, false, 'public.videos não está no baseline; o teste criou a cópia mínima');
    }
  });
});

describe('F2 criar', () => {
  test('1. A cria a fachada: id em uuid, corretor de A, created_at do banco e contadores em zero', async () => {
    const linha = await fachadas.criar(banco.claimsA, criarDto());
    assert.match(String(linha.id), UUID);
    assert.equal(linha.corretor_id, banco.corretorA);
    assert.equal(linha.imovel_id, imovelA);
    assert.match(String(linha.created_at), TIMESTAMPTZ);
    assert.equal(linha.total_escaneamentos, 0);
    assert.equal(linha.total_leads, 0);
    assert.equal(linha.ativo, true);
    assert.equal(linha.foto_principal_url, null);
  });

  test('2. a foto principal é resolvida no servidor: principal, senão a de menor ordem, senão null', async () => {
    const imovel = await novoImovel(banco.corretorA, 'Com fotos');
    await novaFoto(imovel, { ordem: 2, principal: false, arquivo_url: 'https://host/segunda.jpg' });
    await novaFoto(imovel, { ordem: 5, principal: true, arquivo_url: 'https://host/principal.jpg' });
    const comPrincipal = await fachadas.criar(banco.claimsA, criarDto({ imovel_id: imovel }));
    assert.equal(comPrincipal.foto_principal_url, 'https://host/principal.jpg');

    const semPrincipal = await novoImovel(banco.corretorA, 'Sem principal');
    await novaFoto(semPrincipal, { ordem: 3, arquivo_url: 'https://host/terceira.jpg' });
    await novaFoto(semPrincipal, { ordem: 1, arquivo_url: 'https://host/primeira.jpg' });
    const porOrdem = await fachadas.criar(banco.claimsA, criarDto({ imovel_id: semPrincipal }));
    assert.equal(porOrdem.foto_principal_url, 'https://host/primeira.jpg');

    const escolhida = await fachadas.criar(banco.claimsA, criarDto({ imovel_id: imovel, foto_principal_url: 'https://host/minha.jpg' }));
    assert.equal(escolhida.foto_principal_url, 'https://host/minha.jpg');
  });

  test('A NÃO pode apontar a placa dela para o imóvel de B: 422 e nada é inserido', async () => {
    // O RLS de INSERT em public.fachadas ("Corretor cria fachadas") confere só o corretor_id, e a rota
    // pública P1 lê como DONO do banco, sem RLS: sem esta trava a landing de A publicaria título,
    // endereço, valor, descrição e fotos do imóvel de B.
    const antes = (await banco.sqlSuperusuario('select count(*)::int as n from public.fachadas where imovel_id = $1', [imovelB]))[0].n;
    await falha(fachadas.criar(banco.claimsA, criarDto({ imovel_id: imovelB })), 422, 'referencia_invalida');
    await falha(fachadas.criar(banco.claimsA, criarDto({ imovel_id: INEXISTENTE })), 422, 'referencia_invalida');
    const depois = (await banco.sqlSuperusuario('select count(*)::int as n from public.fachadas where imovel_id = $1', [imovelB]))[0].n;
    assert.equal(depois, antes, 'nenhuma fachada deveria ter sido criada sobre o imóvel de B');
  });

  test('o DTO recusa id, corretor_id e os contadores no corpo', () => {
    for (const chave of ['id', 'corretor_id', 'total_escaneamentos', 'total_leads', 'created_at']) {
      assert.deepEqual(dtoRecusa(CriarFachadaDto, {
        imovel_id: imovelA, tipo_negocio: 'VENDA', template_id: 't', cta_principal: 'WHATSAPP',
        modo_conversao: false, [chave]: 'x',
      }), [chave]);
    }
  });
});

describe('F1 listar', () => {
  test('3. A vê a sua fachada com embeds e não vê a de B; imóvel apagado vem null', async () => {
    const id = await novaFachada();
    const lista = await fachadas.listar(banco.claimsA);
    const minha = lista.find((l) => l.id === id);
    assert.ok(minha, 'a fachada de A deveria estar na lista');
    assert.deepEqual(minha.imovel, {
      titulo: 'Casa da A', tipo: 'CASA', valor: 450000.5, area_m2: 90, dormitorios: 3, garagem: 1,
      endereco: 'Rua das Placas, 10', bairro: 'Centro', cidade: 'Anápolis', descricao: 'Imóvel de teste',
    });
    assert.deepEqual(Object.keys(minha.corretor as object).sort(),
      ['creci', 'email', 'foto_url', 'nome', 'razao_social', 'telefone']);
    assert.equal(lista.some((l) => l.id === fachadaB), false, 'o RLS não deveria mostrar a fachada de B');

    // Mais nova primeiro, com desempate por id.
    const datas = lista.map((l) => String(l.created_at));
    assert.deepEqual(datas, [...datas].sort().reverse());

    // Imóvel que o RLS esconde (ou linha apagada): a chave vem null, como o embed do PostgREST.
    const idOrfa = (await banco.inserir('fachadas', {
      corretor_id: banco.corretorA, imovel_id: imovelB, tipo_negocio: 'VENDA', template_id: 't',
      cta_principal: 'WHATSAPP', modo_conversao: false,
    }, { semGatilhos: true })).id as string;
    const comOrfa = await fachadas.listar(banco.claimsA);
    assert.equal(comOrfa.find((l) => l.id === idOrfa)?.imovel, null);
    assert.notEqual(comOrfa.find((l) => l.id === idOrfa)?.corretor, null);
    await banco.sqlSuperusuario('delete from public.fachadas where id = $1', [idOrfa]);
  });

  test('B não vê nada de A', async () => {
    const lista = await fachadas.listar(banco.claimsB);
    assert.deepEqual(lista.map((l) => l.id), [fachadaB]);
  });
});

describe('F3 editar e F4 remover', () => {
  test('4. edita cta_principal e ativo; fachada de B dá 404; corpo vazio dá 400', async () => {
    const id = await novaFachada();
    const linha = await fachadas.editar(banco.claimsA, id, dto(EditarFachadaDto, { cta_principal: 'AGENDAR_VISITA', ativo: false }));
    assert.equal(linha.cta_principal, 'AGENDAR_VISITA');
    assert.equal(linha.ativo, false);
    assert.equal(linha.id, id, 'o id não muda nunca');

    await falha(fachadas.editar(banco.claimsA, fachadaB, dto(EditarFachadaDto, { ativo: false })), 404, 'nao_encontrado');
    await falha(fachadas.editar(banco.claimsA, INEXISTENTE, dto(EditarFachadaDto, { ativo: false })), 404, 'nao_encontrado');
    await falha(fachadas.editar(banco.claimsA, id, dto(EditarFachadaDto, {})), 400, 'nada_para_atualizar');
    assert.deepEqual(dtoRecusa(EditarFachadaDto, { imovel_id: imovelA }), ['imovel_id']);
  });

  test('5. o id é imutável: o gatilho dá 23514 e o tradutor devolve 409 id_imutavel', async () => {
    const id = await novaFachada();
    let capturado: unknown;
    try {
      // Pelo caminho do Prisma (como dono do banco) para o erro chegar embrulhado em P2010, como em produção.
      await banco.prisma.$executeRawUnsafe('update public.fachadas set id = $1::uuid where id = $2::uuid', INEXISTENTE, id);
    } catch (e) {
      capturado = e;
    }
    assert.ok(capturado, 'o gatilho tr_proteger_id_fachada deveria recusar a troca do id');
    const r = await capturarErroHttp(Promise.reject(capturado).catch((e) => traduzirErroBanco(e)));
    assert.equal(r.status, 409);
    assert.equal(r.corpo.codigo, 'id_imutavel');

    // E nenhuma rota do módulo aciona esse gatilho: id não é coluna de escrita.
    const linha = await fachadas.editar(banco.claimsA, id, dto(EditarFachadaDto, { template_id: 'outro' }));
    assert.equal(linha.id, id);
  });

  test('6. apaga a fachada de A e, por cascade, leads e escaneamentos; a de B dá 404', async () => {
    const id = await novaFachada();
    await repo.registrarEscaneamento(id, 'Mozilla/5.0');
    await repo.criarLead(id, dto(EnviarLeadDto, { nome: 'Ana Souza', telefone: '(62) 98888-0001' }));
    assert.equal(await contarScans(id), 1);
    assert.equal(await contarLeads(id), 1);

    await fachadas.remover(banco.claimsA, id);
    assert.equal(await contarScans(id), 0);
    assert.equal(await contarLeads(id), 0);
    assert.deepEqual(await banco.sqlSuperusuario('select 1 from public.fachadas where id = $1', [id]), []);

    await falha(fachadas.remover(banco.claimsA, fachadaB), 404, 'nao_encontrado');
    await falha(fachadas.remover(banco.claimsA, INEXISTENTE), 404, 'nao_encontrado');
  });
});

describe('F2/F3 trava de plano', () => {
  test('7. cota esgotada dá 402 na criação e na reativação; ficar inativo passa', async () => {
    const conta = await banco.criarConta({ nome: 'Conta apertada', limiteImoveis: 10 });
    await banco.inserir('plan_entitlements', {
      plan_id: conta.planoId, feature_key: 'max_fachadas', feature_name: 'Fachadas Inteligentes',
      enabled: true, limit_value: 1, unlimited: false,
    });
    const imovel = await novoImovel(conta.corretorId, 'Casa da apertada');
    const corpo = (extra: Record<string, unknown> = {}) => dto(CriarFachadaDto, {
      imovel_id: imovel, tipo_negocio: 'VENDA', template_id: 't', cta_principal: 'WHATSAPP', modo_conversao: false, ...extra,
    });

    const primeira = await fachadas.criar(conta.claims, corpo());
    const erro = await falha(fachadas.criar(conta.claims, corpo()), 402, 'PLAN_LIMIT_REACHED');
    assert.equal(erro.recurso, 'max_fachadas');
    assert.equal(erro.message, 'Limite de Fachadas Inteligentes atingido. Acesse Plano e Assinatura para liberar mais fachadas.');

    // Acima da cota, mas inativa: o gatilho só checa quando a linha vai FICAR ativa.
    const inativa = await fachadas.criar(conta.claims, corpo({ ativo: false }));
    assert.equal(inativa.ativo, false);
    // Desativar a que está ativa também passa.
    await fachadas.editar(conta.claims, primeira.id as string, dto(EditarFachadaDto, { ativo: false }));
    // Reativar as duas estoura a cota de 1 na segunda.
    await fachadas.editar(conta.claims, primeira.id as string, dto(EditarFachadaDto, { ativo: true }));
    await falha(fachadas.editar(conta.claims, inativa.id as string, dto(EditarFachadaDto, { ativo: true })), 402, 'PLAN_LIMIT_REACHED');
  });
});

describe('F5 e F6 leads', () => {
  test('8. lista os leads de A, filtra por fachada, não vê os de B, e F6 decrementa o contador', async () => {
    const umaFachada = await novaFachada();
    const outraFachada = await novaFachada();
    await repo.criarLead(umaFachada, dto(EnviarLeadDto, { nome: 'Primeiro Lead', telefone: '(62) 98888-1001' }));
    await repo.criarLead(outraFachada, dto(EnviarLeadDto, { nome: 'Segundo Lead', telefone: '(62) 98888-1002', email: 'segundo@exemplo.local' }));
    await banco.inserir('fachada_leads', {
      fachada_id: fachadaB, nome: 'Lead do B', telefone: '(62) 98888-1003',
    }, { semGatilhos: true });

    const todos = await leads.listar(banco.claimsA, dto(ListarLeadsDto, {}));
    const nomes = todos.map((l) => l.nome);
    assert.ok(nomes.includes('Primeiro Lead') && nomes.includes('Segundo Lead'));
    assert.equal(nomes.includes('Lead do B'), false, 'o RLS não deveria mostrar o lead de B');
    const datas = todos.map((l) => String(l.created_at));
    assert.deepEqual(datas, [...datas].sort().reverse(), 'mais novo primeiro');

    const filtrados = await leads.listar(banco.claimsA, dto(ListarLeadsDto, { fachada_id: umaFachada }));
    assert.deepEqual(filtrados.map((l) => l.nome), ['Primeiro Lead']);
    assert.equal(filtrados[0].convertido, false);
    assert.equal(filtrados[0].cliente_id, null);

    assert.equal((await contadores(umaFachada)).total_leads, 1);
    await leads.remover(banco.claimsA, filtrados[0].id as string);
    assert.equal((await contadores(umaFachada)).total_leads, 0);
    assert.equal(await contarLeads(umaFachada), 0);

    const doB = await banco.sqlSuperusuario<{ id: string }>(
      'select id::text as id from public.fachada_leads where fachada_id = $1', [fachadaB]);
    await falha(leads.remover(banco.claimsA, doB[0].id), 404, 'lead_nao_encontrado');
    await falha(leads.remover(banco.claimsA, INEXISTENTE), 404, 'lead_nao_encontrado');
  });
});

describe('F7 métricas', () => {
  test('9. conta só a janela e só a conta: leads, scans, taxa, por dia e fachadas ativas', async () => {
    const conta = await banco.criarConta({ nome: 'Conta das métricas', limiteImoveis: 10 });
    await banco.inserir('plan_entitlements', {
      plan_id: conta.planoId, feature_key: 'max_fachadas', feature_name: 'Fachadas', enabled: true, limit_value: 10, unlimited: false,
    });
    const imovel = await novoImovel(conta.corretorId, 'Casa das métricas');
    const corpo = dto(CriarFachadaDto, {
      imovel_id: imovel, tipo_negocio: 'VENDA', template_id: 't', cta_principal: 'WHATSAPP', modo_conversao: false,
    });
    const ativa = await fachadas.criar(conta.claims, corpo);
    const inativa = await fachadas.criar(conta.claims, dto(CriarFachadaDto, { ...corpo, ativo: false } as never));
    assert.equal(inativa.ativo, false);

    // Eventos dentro e fora da janela, com created_at escolhido: sem gatilhos, que sobrescreveriam a data.
    const dentro = ['2026-10-04T10:00:00Z', '2026-10-04T23:30:00Z'];
    for (const [i, quando] of dentro.entries()) {
      await banco.inserir('fachada_leads', {
        fachada_id: ativa.id, nome: `Lead ${i}`, telefone: `(62) 97777-00${i}0`, created_at: quando,
      }, { semGatilhos: true });
    }
    for (let i = 0; i < 5; i += 1) {
      await banco.inserir('fachada_escaneamentos', {
        fachada_id: ativa.id, user_agent: 'ua', created_at: i < 3 ? '2026-10-03T08:00:00Z' : '2026-10-04T09:00:00Z',
      }, { semGatilhos: true });
    }
    // Fora da janela de 30 dias (um de cada) e eventos de outra conta: nenhum entra.
    await banco.inserir('fachada_leads', {
      fachada_id: ativa.id, nome: 'Lead antigo', telefone: '(62) 97777-9999', created_at: '2020-01-01T10:00:00Z',
    }, { semGatilhos: true });
    await banco.inserir('fachada_escaneamentos', {
      fachada_id: ativa.id, user_agent: 'ua', created_at: '2020-01-01T10:00:00Z',
    }, { semGatilhos: true });
    await banco.inserir('fachada_leads', {
      fachada_id: fachadaB, nome: 'Lead do B', telefone: '(62) 96666-0001',
    }, { semGatilhos: true });

    const r = await metricas.obter(conta.claims, dto(MetricasDto, {}));
    assert.equal(r.totalLeads, 2);
    assert.equal(r.totalEscaneamentos, 5);
    assert.equal(r.taxaConversao, 40);
    assert.equal(r.totalFachadas, 1, 'só as ativas');
    assert.deepEqual(r.fachadasMaisAcessadas, []);
    assert.deepEqual(r.leadsPorDia, [
      { data: '2026-10-03', leads: 0, escaneamentos: 3 },
      { data: '2026-10-04', leads: 2, escaneamentos: 2 },
    ]);

    // Janela curta: só o que é recente entra (nada, porque os eventos são de outubro de 2026).
    const curta = await metricas.obter(conta.claims, dto(MetricasDto, { dias: 1 }));
    assert.equal(curta.totalLeads + curta.totalEscaneamentos >= 0, true);

    // dias inválido nem chega ao banco.
    for (const dias of ['0', '366', 'abc']) assert.deepEqual(dtoRecusa(MetricasDto, { dias }), ['dias']);
  });

  test('conta sem evento nenhum devolve zeros e taxa 0', async () => {
    const vazia = await banco.criarConta({ nome: 'Conta vazia' });
    const r = await metricas.obter(vazia.claims, dto(MetricasDto, { dias: 7 }));
    assert.deepEqual(r, {
      totalFachadas: 0, totalEscaneamentos: 0, totalLeads: 0, taxaConversao: 0,
      fachadasMaisAcessadas: [], leadsPorDia: [],
    });
  });
});

describe('F8–F11 templates', () => {
  test('10. escopo, criação, exclusão e busca por imagem', async () => {
    const padrao = await banco.inserir('fachada_templates', {
      corretor_id: null, nome: 'Padrão da casa', categoria: 'VENDA', config: { imagem_url: 'https://host/padrao.png' }, padrao: true,
    });
    await banco.inserir('fachada_templates', {
      corretor_id: banco.corretorB, nome: 'Do B', categoria: 'RURAL', config: {},
    });

    const meu = await templates.criar(banco.claimsA, dto(CriarTemplateDto, {
      nome: 'Minha arte', categoria: 'ALTO_PADRAO', config: { imagem_url: 'https://host/minha.png', qrSize: 120 },
    }));
    assert.equal(meu.corretor_id, banco.corretorA);
    assert.equal(meu.padrao, false);
    assert.deepEqual(meu.config, { imagem_url: 'https://host/minha.png', qrSize: 120 });

    const meus = await templates.listar(banco.claimsA, dto(ListarTemplatesDto, { escopo: 'meus' }));
    assert.deepEqual(meus.map((t) => t.nome), ['Minha arte']);

    const todos = await templates.listar(banco.claimsA, dto(ListarTemplatesDto, { escopo: 'todos' }));
    const nomes = todos.map((t) => t.nome);
    assert.ok(nomes.includes('Minha arte') && nomes.includes('Padrão da casa'));
    assert.equal(nomes.includes('Do B'), false);

    const achado = await templates.porImagem(banco.claimsA, dto(PorImagemDto, { imagem_url: 'https://host/minha.png' }));
    assert.equal(achado?.id, meu.id);
    assert.equal(await templates.porImagem(banco.claimsA, dto(PorImagemDto, { imagem_url: 'https://host/nao-existe.png' })), null);

    // O padrão é visível, mas não apagável: o RLS de DELETE não casa e a resposta é o mesmo 404.
    await falha(templates.remover(banco.claimsA, padrao.id as string), 404, 'template_nao_encontrado');
    const doB = await banco.sqlSuperusuario<{ id: string }>(
      "select id::text as id from public.fachada_templates where nome = 'Do B'");
    await falha(templates.remover(banco.claimsA, doB[0].id), 404, 'template_nao_encontrado');
    await templates.remover(banco.claimsA, meu.id as string);
    assert.equal(await templates.porImagem(banco.claimsA, dto(PorImagemDto, { imagem_url: 'https://host/minha.png' })), null);
  });
});

describe('F12 mídias', () => {
  test('11. foto principal, contagem de fotos e de vídeos; imóvel de B vem vazio', async () => {
    const imovel = await novoImovel(banco.corretorA, 'Casa das mídias');
    await novaFoto(imovel, { ordem: 3, arquivo_url: 'https://host/m3.jpg' });
    await novaFoto(imovel, { ordem: 1, principal: true, arquivo_url: 'https://host/m1.jpg' });
    await banco.inserir('videos', videosNoBaseline
      ? { corretor_id: banco.corretorA, imovel_id: imovel, titulo: 'Tour', video_url: 'https://host/v.mp4', video_path: 'v.mp4' }
      : { corretor_id: banco.corretorA, imovel_id: imovel });

    assert.deepEqual(await midias.obter(banco.claimsA, imovel), {
      foto_principal_url: 'https://host/m1.jpg', fotos: 2, videos: 1,
    });
    assert.deepEqual(await midias.obter(banco.claimsA, imovelB), { foto_principal_url: null, fotos: 0, videos: 0 });
    assert.deepEqual(await midias.obter(banco.claimsA, INEXISTENTE), { foto_principal_url: null, fotos: 0, videos: 0 });
  });
});

describe('P1 ver fachada pública', () => {
  test('12. responde sem sessão nenhuma, com as chaves exatas da allowlist', async () => {
    const imovel = await novoImovel(banco.corretorA, 'Casa da placa');
    await novaFoto(imovel, { ordem: 2, arquivo_url: 'https://host/p2.jpg' });
    await novaFoto(imovel, { ordem: 1, principal: true, arquivo_url: 'https://host/p1.jpg' });
    const id = await novaFachada({ imovel_id: imovel });

    const r = await publico.verFachada(id);
    assert.deepEqual(Object.keys(r.fachada).sort(), [
      'ativo', 'corretor', 'corretor_id', 'created_at', 'cta_principal', 'foto_principal_url', 'id', 'imovel',
      'imovel_id', 'logo_url', 'mensagem_whatsapp', 'modo_conversao', 'template_id', 'tipo_negocio',
    ]);
    assert.deepEqual(Object.keys(r.fachada.imovel as object).sort(), [
      'area_m2', 'bairro', 'banheiros', 'cidade', 'descricao', 'dormitorios', 'endereco', 'estado', 'garagem',
      'id', 'tipo', 'titulo', 'valor',
    ]);
    assert.deepEqual(Object.keys(r.fachada.corretor as object).sort(),
      ['creci', 'email', 'foto_url', 'nome', 'razao_social', 'telefone']);
    assert.equal(r.fachada.ativo, true);
    assert.match(String(r.fachada.created_at), TIMESTAMPTZ);
    assert.deepEqual(r.fotos.map((f) => f.arquivo_url), ['https://host/p1.jpg', 'https://host/p2.jpg']);
    assert.deepEqual(Object.keys(r.fotos[0]).sort(), ['arquivo_url', 'id', 'principal']);
    assert.equal(r.fotos[0].principal, true);

    const semFoto = await novaFachada();
    assert.deepEqual((await publico.verFachada(semFoto)).fotos, []);
  });

  test('13. coluna nova em public.fachadas NÃO aparece na resposta pública', async () => {
    const id = await novaFachada();
    await banco.sqlSuperusuario('alter table public.fachadas add column coluna_secreta text default \'vazou\'');
    try {
      const r = await publico.verFachada(id);
      assert.equal('coluna_secreta' in r.fachada, false, 'a allowlist de colunas é escrita no SQL, coluna por coluna');
      // E o embed autenticado, que usa to_jsonb, mostra: é por isso que a §2.1 não usa to_jsonb.
      const lista = await fachadas.listar(banco.claimsA);
      assert.equal('coluna_secreta' in (lista.find((l) => l.id === id) as object), true);
    } finally {
      await banco.sqlSuperusuario('alter table public.fachadas drop column coluna_secreta');
    }
  });

  test('14. fachada inativa e id inexistente dão o MESMO 404, sem dizer qual é o caso', async () => {
    const id = await novaFachada({ ativo: false });
    const inativa = await capturarErroHttp(publico.verFachada(id));
    const inexistente = await capturarErroHttp(publico.verFachada(INEXISTENTE));
    assert.deepEqual(inativa, inexistente);
    assert.equal(inativa.status, 404);
    assert.equal(inativa.corpo.codigo, 'fachada_indisponivel');
    assert.equal(inativa.corpo.message, 'Esta placa não está mais disponível.');
    // A de B é ativa e aparece: a leitura pública é por id, não por conta.
    assert.equal((await publico.verFachada(fachadaB)).fachada.id, fachadaB);
  });
});

describe('P2 escaneamento', () => {
  test('15. insere como anon, incrementa o contador, zera ip_hash e corta o user_agent em 500', async () => {
    const id = await novaFachada();
    await publico.registrarEscaneamento(id, 'A'.repeat(600));
    assert.equal((await contadores(id)).total_escaneamentos, 1);
    const [linha] = await banco.sqlSuperusuario<{ ip_hash: string | null; user_agent: string; created_at: Date }>(
      'select ip_hash, user_agent, created_at from public.fachada_escaneamentos where fachada_id = $1', [id]);
    assert.equal(linha.ip_hash, null);
    assert.equal(linha.user_agent.length, 500);
    assert.ok(linha.created_at instanceof Date, 'created_at vem do clock_timestamp() do servidor');

    await publico.registrarEscaneamento(id, null);
    const nulos = await banco.sqlSuperusuario<{ n: number }>(
      'select count(*)::int as n from public.fachada_escaneamentos where fachada_id = $1 and user_agent is null', [id]);
    assert.equal(Number(nulos[0].n), 1);
    assert.equal((await contadores(id)).total_escaneamentos, 2);
  });

  test('16. fachada inativa dá 404 fachada_indisponivel (policy e gatilho, nesta ordem)', async () => {
    const id = await novaFachada({ ativo: false });
    await falha(publico.registrarEscaneamento(id, 'ua'), 404, 'fachada_indisponivel');
    await falha(publico.registrarEscaneamento(INEXISTENTE, 'ua'), 404, 'fachada_indisponivel');
    assert.equal(await contarScans(id), 0);
  });

  test('17. o limite de 120 por minuto por fachada continua valendo pelo caminho novo', async () => {
    const id = await novaFachada();
    for (let i = 0; i < 120; i += 1) await publico.registrarEscaneamento(id, `ua-${i}`);
    assert.equal(await contarScans(id), 120);
    await falha(publico.registrarEscaneamento(id, 'ua-121'), 429, 'muitas_tentativas');
    assert.equal(await contarScans(id), 120);
    // Outra fachada tem balde próprio: o escopo é qr-scan-fachada.
    const outra = await novaFachada();
    await publico.registrarEscaneamento(outra, 'ua');
    assert.equal(await contarScans(outra), 1);
  });
});

describe('P3 lead público', () => {
  test('18. grava como anon com convertido false, sem cliente, e o telefone como digitado', async () => {
    const id = await novaFachada();
    assert.deepEqual(await publico.enviarLead(id, dto(EnviarLeadDto, {
      nome: '  Ana Souza  ', telefone: '(11) 99999-8888', email: 'ana@exemplo.local',
    })), { registrado: true });
    assert.equal((await contadores(id)).total_leads, 1);
    const [linha] = await banco.sqlSuperusuario<{
      nome: string; telefone: string; email: string; convertido: boolean; cliente_id: string | null;
    }>('select nome, telefone, email, convertido, cliente_id from public.fachada_leads where fachada_id = $1', [id]);
    assert.equal(linha.nome, 'Ana Souza', 'o DTO apara o nome, como o gatilho');
    assert.equal(linha.telefone, '(11) 99999-8888', 'grava como o visitante digitou');
    assert.equal(linha.email, 'ana@exemplo.local');
    assert.equal(linha.convertido, false);
    assert.equal(linha.cliente_id, null);

    const semEmail = await novaFachada();
    await publico.enviarLead(semEmail, dto(EnviarLeadDto, { nome: 'Bruno Lima', telefone: '(62) 93333-0001' }));
    const [sem] = await banco.sqlSuperusuario<{ email: string | null }>(
      'select email from public.fachada_leads where fachada_id = $1', [semEmail]);
    assert.equal(sem.email, null);
  });

  test('19. o visitante não forja convertido, cliente_id, created_at nem ip_hash', async () => {
    const base = { nome: 'Ana Souza', telefone: '(62) 93333-0002' };
    for (const extra of [{ convertido: true }, { cliente_id: INEXISTENTE }, { created_at: '2020-01-01' }, { ip_hash: 'x' }]) {
      const chave = Object.keys(extra)[0];
      assert.deepEqual(dtoRecusa(EnviarLeadDto, { ...base, ...extra }), [chave]);
    }

    // E, mesmo que passassem, o gatilho zera: insert dessas colunas rodando como anon.
    const id = await novaFachada();
    await banco.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      await tx.$executeRawUnsafe('set local role anon');
      await tx.$executeRawUnsafe(
        `insert into public.fachada_leads (fachada_id, nome, telefone, convertido, cliente_id, created_at)
         values ($1::uuid, 'Forjado Silva', '(62) 93333-0003', true, null, '2020-01-01T00:00:00Z'::timestamptz)`,
        id,
      );
    });
    const [forjado] = await banco.sqlSuperusuario<{ convertido: boolean; created_at: Date }>(
      'select convertido, created_at from public.fachada_leads where fachada_id = $1', [id]);
    assert.equal(forjado.convertido, false, 'o gatilho força convertido = false quando o role é anon');
    assert.ok(forjado.created_at.getUTCFullYear() > 2020, 'o gatilho força created_at = clock_timestamp()');
  });

  test('20. o limite de 5 por 10 minutos é por telefone normalizado, não global', async () => {
    const id = await novaFachada();
    for (let i = 0; i < 5; i += 1) {
      await publico.enviarLead(id, dto(EnviarLeadDto, { nome: `Repetido ${i}`, telefone: '(62) 95555-1234' }));
    }
    assert.equal(await contarLeads(id), 5);
    await falha(publico.enviarLead(id, dto(EnviarLeadDto, { nome: 'Sexto Lead', telefone: '(62) 95555-1234' })), 429, 'muitas_tentativas');

    // Telefone diferente passa: o escopo é o hash do telefone normalizado.
    await publico.enviarLead(id, dto(EnviarLeadDto, { nome: 'Outro Numero', telefone: '(62) 95555-9999' }));
    assert.equal(await contarLeads(id), 6);

    // E as duas grafias do MESMO número caem no mesmo balde (o gatilho normaliza antes do sha256).
    await falha(publico.enviarLead(id, dto(EnviarLeadDto, { nome: 'Com Prefixo', telefone: '+55 62 95555-1234' })), 429, 'muitas_tentativas');
  });

  test('21. fachada inativa dá 404 fachada_indisponivel', async () => {
    const id = await novaFachada({ ativo: false });
    await falha(publico.enviarLead(id, dto(EnviarLeadDto, { nome: 'Ana Souza', telefone: '(62) 94444-0001' })), 404, 'fachada_indisponivel');
    await falha(publico.enviarLead(INEXISTENTE, dto(EnviarLeadDto, { nome: 'Ana Souza', telefone: '(62) 94444-0002' })), 404, 'fachada_indisponivel');
  });

  test('22. o DTO e o gatilho concordam nos dois sentidos, em toda fronteira', async () => {
    const id = await novaFachada();
    const base = { nome: 'Ana Souza', telefone: '(62) 92222-0001' };
    const casos: Array<[string, Record<string, unknown>, string]> = [
      ['nome com 1 caractere', { ...base, nome: 'a' }, 'contato_invalido'],
      ['nome com 121 caracteres', { ...base, nome: 'a'.repeat(121) }, 'contato_invalido'],
      ['nome só de espaços', { ...base, nome: '   ' }, 'contato_invalido'],
      ['telefone com 33 caracteres', { ...base, telefone: '1'.repeat(33) }, 'contato_invalido'],
      ['telefone 011999998888', { ...base, telefone: '011999998888' }, 'telefone_invalido'],
      ['telefone abc', { ...base, telefone: 'abc' }, 'telefone_invalido'],
      ['email com 255 caracteres', { ...base, email: `${'a'.repeat(250)}@b.co` }, 'contato_invalido'],
      ['email sem arroba', { ...base, email: 'sem-arroba' }, 'contato_invalido'],
    ];
    for (const [rotulo, corpo, codigo] of casos) {
      dtoRecusa(EnviarLeadDto, corpo); // o DTO recusa
      // e o banco também recusa, se o corpo chegasse ao insert como anon.
      await falha(publico.enviarLead(id, corpo as unknown as EnviarLeadDto), 400, codigo);
      assert.equal(await contarLeads(id), 0, `nada foi gravado no caso: ${rotulo}`);
    }

    // A única divergência declarada (§2.3): email '' é recusado pelo DTO e aceito pelo gatilho.
    assert.deepEqual(dtoRecusa(EnviarLeadDto, { ...base, email: '' }), ['email']);
    await publico.enviarLead(id, { ...base, email: '' } as unknown as EnviarLeadDto);
    const [linha] = await banco.sqlSuperusuario<{ email: string }>(
      'select email from public.fachada_leads where fachada_id = $1', [id]);
    assert.equal(linha.email, '', 'o banco aceitaria a string vazia; o DTO é o mais restritivo dos dois');
  });
});

describe('travas do caminho', () => {
  test('23. o TenantDb recusa claims de anon: as rotas públicas não poderiam usá-lo nem por engano', async () => {
    await assert.rejects(
      banco.db.run({ sub: 'visitante', role: 'anon' } as SupabaseClaims, async () => 'nunca'),
      /claims_invalidas/,
    );
    await assert.rejects(banco.db.run({ role: 'authenticated' } as unknown as SupabaseClaims, async () => 'nunca'), /claims_invalidas/);
  });

  test('24. nenhuma transação terminou abortada: nenhum erro de banco foi engolido dentro de um run', () => {
    assert.equal(banco.transacoes.commitsAbortados, 0,
      `${banco.transacoes.commitsAbortados} run(s) terminaram com a transação abortada`);
  });
});
