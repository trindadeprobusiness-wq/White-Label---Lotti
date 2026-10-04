import test from 'node:test';
import assert from 'node:assert/strict';
import { camel, gerarSchema, lerCatalogo, padraoPrisma, pascal, singular, tipoPrisma } from './gerar-schema.mjs';

test('singular cobre os plurais das tabelas da Lotti', () => {
  const casos = {
    imoveis: 'imovel', clientes: 'cliente', corretores: 'corretor', comissoes: 'comissao', sessoes: 'sessao',
    percentuais: 'percentual', itens: 'item', deliveries: 'delivery', repasses: 'repasse', events: 'event',
    plans: 'plan', progress: 'progress', status: 'status', asaas: 'asaas', lotti: 'lotti', ai: 'ai', sem: 'sem',
    aluguel: 'aluguel', addons: 'addon', imagens: 'imagem', financeiros: 'financeiro', cliques: 'clique', diagnostics: 'diagnostic',
  };
  for (const [plural, esperado] of Object.entries(casos)) assert.equal(singular(plural), esperado, plural);
});

test('nomes de modelo e campo no padrão do Clix', () => {
  assert.equal(pascal('faturas_aluguel', true), 'FaturaAluguel');
  assert.equal(pascal('admin_sessoes_suporte', true), 'AdminSessaoSuporte');
  assert.equal(pascal('lotti_agent_messages', true), 'LottiAgentMessage');
  assert.equal(pascal('imoveis', true), 'Imovel');
  assert.equal(camel('area_m2'), 'areaM2');
  assert.equal(camel('corretor_id'), 'corretorId');
  assert.equal(camel('faturas_aluguel'), 'faturasAluguel');
});

const col = (nome, tipo, extra = {}) => ({
  nome, tipo, tipo_base: tipo, tipo_categoria: 'b', elem_base: null, elem_categoria: null,
  obrigatorio: false, padrao: null, identidade: '', gerada: '', ...extra,
});

test('tipos do Postgres viram tipos do Prisma com o tipo nativo', () => {
  const enums = new Map([['tipo_imovel', { nome: 'TipoImovel', valores: new Map([['CASA', 'CASA']]) }]]);
  const casos = [
    ['uuid', 'String', '@db.Uuid'], ['text', 'String', null], ['character varying(80)', 'String', '@db.VarChar(80)'],
    ['character(2)', 'String', '@db.Char(2)'], ['integer', 'Int', null], ['smallint', 'Int', '@db.SmallInt'],
    ['bigint', 'BigInt', null], ['numeric(12,2)', 'Decimal', '@db.Decimal(12, 2)'], ['numeric', 'Decimal', '@db.Decimal'],
    ['boolean', 'Boolean', null], ['timestamp with time zone', 'DateTime', '@db.Timestamptz(6)'],
    ['date', 'DateTime', '@db.Date'], ['time without time zone', 'DateTime', '@db.Time(6)'], ['jsonb', 'Json', null],
  ];
  for (const [pg, tipo, nativo] of casos) assert.deepEqual(tipoPrisma(col('x', pg), enums), { tipo, nativo, lista: false }, pg);
  assert.deepEqual(tipoPrisma(col('x', 'text[]', { elem_base: 'text', elem_categoria: 'b' }), enums), { tipo: 'String', nativo: null, lista: true });
  assert.deepEqual(tipoPrisma(col('x', 'uuid[]', { elem_base: 'uuid', elem_categoria: 'b' }), enums), { tipo: 'String', nativo: '@db.Uuid', lista: true });
  assert.equal(tipoPrisma(col('x', 'tipo_imovel', { tipo_base: 'tipo_imovel', tipo_categoria: 'e' }), enums).tipo, 'TipoImovel');
  assert.equal(tipoPrisma(col('x', 'tsvector'), enums).tipo, 'Unsupported("tsvector")');
});

test('padrões do banco viram @default fiéis', () => {
  const enums = new Map([['situacao', { nome: 'Situacao', valores: new Map([['em aberto', 'em_aberto']]) }]]);
  const p = (pg, padrao, extra = {}) => { const c = col('x', pg, { padrao, ...extra }); return padraoPrisma(c, tipoPrisma(c, enums), enums); };
  assert.equal(p('uuid', 'gen_random_uuid()'), '@default(dbgenerated("gen_random_uuid()"))');
  assert.equal(p('timestamp with time zone', 'now()'), '@default(now())');
  assert.equal(p('boolean', 'false'), '@default(false)');
  assert.equal(p('integer', '0'), '@default(0)');
  assert.equal(p('numeric(12,2)', '0.00'), '@default(0.00)');
  assert.equal(p('numeric', "'10'::numeric"), '@default(10)');
  assert.equal(p('text', "'PENDENTE'::text"), '@default("PENDENTE")');
  assert.equal(p('text', "'it''s'::text"), '@default("it\'s")');
  assert.equal(p('jsonb', "'{}'::jsonb"), '@default("{}")');
  assert.equal(p('text[]', "'{}'::text[]", { elem_base: 'text', elem_categoria: 'b' }), '@default([])');
  assert.equal(p('situacao', "'em aberto'::situacao", { tipo_base: 'situacao', tipo_categoria: 'e' }), '@default(em_aberto)');
  assert.equal(p('date', 'CURRENT_DATE'), '@default(dbgenerated("CURRENT_DATE"))');
  assert.equal(p('integer', null, { identidade: 'd' }), '@default(autoincrement())');
  assert.equal(p('integer', '1', { gerada: 's' }), null);
});

const restr = (nome, tipo, colunas, ref = {}) => ({ nome, tipo, colunas, ref_tabela: null, ref_schema: null, ref_colunas: [], on_delete: 'a', on_update: 'a', ...ref });
const catalogo = {
  views: ['v_relatorio'],
  enums: [{ nome: 'tipo_imovel', valores: ['CASA', 'APARTAMENTO'] }],
  tabelas: [
    {
      nome: 'corretores', rls: true, gatilhos: null, indices: [],
      colunas: [col('id', 'uuid', { obrigatorio: true, padrao: 'gen_random_uuid()' }), col('user_id', 'uuid', { obrigatorio: true }), col('nome', 'text', { obrigatorio: true })],
      restricoes: [
        restr('corretores_pkey', 'p', ['id']),
        restr('corretores_user_id_key', 'u', ['user_id']),
        restr('corretores_user_id_fkey', 'f', ['user_id'], { ref_tabela: 'users', ref_schema: 'auth', ref_colunas: ['id'], on_delete: 'c' }),
      ],
    },
    {
      nome: 'contratos', rls: true, gatilhos: ['tr_touch'],
      indices: [
        { nome: 'idx_contratos_corretor', unico: false, metodo: 'btree', parcial: false, expressao: false, colunas: [{ c: 'corretor_id', desc: false }, { c: 'created_at', desc: true }] },
        { nome: 'idx_contratos_ativos', unico: false, metodo: 'btree', parcial: true, expressao: false, colunas: [{ c: 'corretor_id', desc: false }] },
      ],
      colunas: [
        col('id', 'uuid', { obrigatorio: true }), col('corretor_id', 'uuid', { obrigatorio: true }),
        col('revisor_id', 'uuid'), col('anterior_id', 'uuid'), col('tipo', 'tipo_imovel', { tipo_base: 'tipo_imovel', tipo_categoria: 'e', obrigatorio: true, padrao: "'CASA'::tipo_imovel" }),
        col('created_at', 'timestamp with time zone', { obrigatorio: true, padrao: 'now()' }),
      ],
      restricoes: [
        restr('contratos_pkey', 'p', ['id']),
        restr('contratos_corretor_id_fkey', 'f', ['corretor_id'], { ref_tabela: 'corretores', ref_schema: 'public', ref_colunas: ['id'], on_delete: 'c' }),
        restr('contratos_revisor_fk', 'f', ['revisor_id'], { ref_tabela: 'corretores', ref_schema: 'public', ref_colunas: ['id'], on_delete: 'n' }),
        restr('contratos_anterior_id_fkey', 'f', ['anterior_id'], { ref_tabela: 'contratos', ref_schema: 'public', ref_colunas: ['id'] }),
        restr('contratos_valor_check', 'c', ['id']),
      ],
    },
    {
      nome: 'log_solto', rls: false, gatilhos: null, indices: [],
      colunas: [col('evento', 'text'), col('corretor_id', 'uuid')],
      restricoes: [restr('log_solto_corretor_id_fkey', 'f', ['corretor_id'], { ref_tabela: 'corretores', ref_schema: 'public', ref_colunas: ['id'] })],
    },
    { nome: '_backup_antigo', rls: false, gatilhos: null, indices: [], colunas: [col('x', 'text')], restricoes: [] },
  ],
};

test('gera o schema completo com relações, índices e documentação', () => {
  const s = gerarSchema(catalogo);
  // Cabeçalho deixa claro o que ficou de fora.
  assert.match(s, /Fora do Prisma: tabelas _backup_antigo; views v_relatorio\./);
  assert.doesNotMatch(s, /model BackupAntigo/);
  // Enum com nome do banco preservado.
  assert.match(s, /enum TipoImovel \{\n {2}CASA\n {2}APARTAMENTO\n\n {2}@@map\("tipo_imovel"\)\n\}/);
  // Modelo no singular, campo camelCase com @map, FK para auth vira só comentário.
  assert.match(s, /model Corretor \{/);
  assert.match(s, /\/\/\/ referencia auth\.users\(id\)\n {2}userId String @unique @map\("user_id"\) @db\.Uuid/);
  assert.match(s, /@@map\("corretores"\)/);
  // Duas FKs para corretores: relações nomeadas e nomes de volta distintos.
  assert.match(s, /corretor Corretor @relation\("contratos_corretor_id_fkey", fields: \[corretorId\], references: \[id\], onDelete: Cascade, onUpdate: NoAction\)/);
  assert.match(s, /revisor Corretor\? @relation\("contratos_revisor_fk", fields: \[revisorId\], references: \[id\], onDelete: SetNull, onUpdate: NoAction, map: "contratos_revisor_fk"\)/);
  assert.match(s, /contratosCorretor Contrato\[\] @relation\("contratos_corretor_id_fkey"\)/);
  assert.match(s, /contratosRevisor Contrato\[\] @relation\("contratos_revisor_fk"\)/);
  // Autorrelação.
  assert.match(s, /anterior Contrato\? @relation\("contratos_anterior_id_fkey"/);
  assert.match(s, /contratosAnterior Contrato\[\] @relation\("contratos_anterior_id_fkey"\)/);
  // Default de enum, índice com ordenação, parcial só documentado, check documentado.
  assert.match(s, /tipo TipoImovel @default\(CASA\)/);
  assert.match(s, /@@index\(\[corretorId, createdAt\(sort: Desc\)\], map: "idx_contratos_corretor"\)/);
  assert.match(s, /Índices parciais\/por expressão só no SQL: idx_contratos_ativos\./);
  assert.match(s, /1 check constraint\(s\) só no SQL\./);
  assert.match(s, /Gatilhos: tr_touch\./);
  // Tabela sem chave: @@ignore e nenhuma relação com ela.
  assert.match(s, /model LogSolto \{[\s\S]*@@ignore\n\}/);
  assert.doesNotMatch(s, /logSolto/);
});

test('lê a saída do supabase db query', () => {
  const texto = 'Initialising...\n' + JSON.stringify({ boundary: 'x', rows: [{ catalogo: { tabelas: [], enums: [] } }], warning: 'x' });
  assert.deepEqual(lerCatalogo(texto), { tabelas: [], enums: [] });
});
