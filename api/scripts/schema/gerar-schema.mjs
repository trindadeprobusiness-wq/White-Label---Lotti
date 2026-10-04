// Gera api/prisma/schema.prisma a partir do catálogo do banco de produção
// (api/scripts/schema/catalogo.sql), no padrão de nomes do Clix: modelo no
// singular em PascalCase e campo em camelCase, os dois com @map/@@map para o
// nome real. Só leitura: nada aqui toca o banco.
//
// Uso:
//   supabase db query --linked -f api/scripts/schema/catalogo.sql > catalogo.json
//   node api/scripts/schema/gerar-schema.mjs catalogo.json api/prisma/schema.prisma
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tabelas de backup avulsas (_backfill_..., _backup_...) não são do sistema.
const EXCLUIR = /^_/;
// Palavras que terminam em "s" mas não estão no plural.
const MANTER = new Set(['status', 'asaas', 'lotti', 'progress', 'analytics', 'pix', 'dados', 'mais', 'sms']);

export function singular(w) {
  if (MANTER.has(w) || w.length <= 3) return w;
  if (w.endsWith('oes')) return w.slice(0, -3) + 'ao';
  if (w.endsWith('eis')) return w.slice(0, -3) + 'el';
  if (w.endsWith('ais')) return w.slice(0, -3) + 'al';
  if (w.endsWith('ens')) return w.slice(0, -2) + 'm';
  if (w.endsWith('ores')) return w.slice(0, -2);
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
export const pascal = (snake, sing = false) => snake.split('_').filter(Boolean).map((w) => cap(sing ? singular(w) : w)).join('');
export const camel = (snake) => { const p = pascal(snake); return p.charAt(0).toLowerCase() + p.slice(1); };

export function tipoPrisma(c, enums) {
  const lista = c.tipo.endsWith('[]');
  const base = lista ? c.tipo.slice(0, -2) : c.tipo;
  const categoria = lista ? c.elem_categoria : c.tipo_categoria;
  const nomeBase = lista ? c.elem_base : c.tipo_base;
  if (categoria === 'e' && enums.has(nomeBase)) return { tipo: enums.get(nomeBase).nome, nativo: null, lista, enumPg: nomeBase };
  const t = (tipo, nativo = null) => ({ tipo, nativo, lista });
  let m;
  if (base === 'uuid') return t('String', '@db.Uuid');
  if (base === 'text') return t('String');
  if ((m = base.match(/^character varying(?:\((\d+)\))?$/))) return t('String', m[1] ? `@db.VarChar(${m[1]})` : '@db.VarChar');
  if ((m = base.match(/^character(?:\((\d+)\))?$/))) return t('String', m[1] ? `@db.Char(${m[1]})` : '@db.Char');
  if (base === 'integer') return t('Int');
  if (base === 'smallint') return t('Int', '@db.SmallInt');
  if (base === 'bigint') return t('BigInt');
  if ((m = base.match(/^numeric(?:\((\d+),(\d+)\))?$/))) return t('Decimal', m[1] ? `@db.Decimal(${m[1]}, ${m[2]})` : '@db.Decimal');
  if (base === 'real') return t('Float', '@db.Real');
  if (base === 'double precision') return t('Float');
  if (base === 'boolean') return t('Boolean');
  if ((m = base.match(/^timestamp(?:\((\d)\))? with time zone$/))) return t('DateTime', `@db.Timestamptz(${m[1] ?? 6})`);
  if ((m = base.match(/^timestamp(?:\((\d)\))? without time zone$/))) return t('DateTime', `@db.Timestamp(${m[1] ?? 6})`);
  if (base === 'date') return t('DateTime', '@db.Date');
  if ((m = base.match(/^time(?:\((\d)\))? without time zone$/))) return t('DateTime', `@db.Time(${m[1] ?? 6})`);
  if ((m = base.match(/^time(?:\((\d)\))? with time zone$/))) return t('DateTime', `@db.Timetz(${m[1] ?? 6})`);
  if (base === 'jsonb') return t('Json');
  if (base === 'json') return t('Json', '@db.Json');
  if (base === 'bytea') return t('Bytes');
  if (base === 'inet') return t('String', '@db.Inet');
  return { tipo: `Unsupported(${JSON.stringify(c.tipo)})`, nativo: null, lista: false, unsupported: true };
}

const NUMERICO = new Set(['Int', 'BigInt', 'Float', 'Decimal']);

export function padraoPrisma(c, ti, enums) {
  if (c.identidade) return '@default(autoincrement())';
  if (c.gerada || c.padrao == null) return null;
  const d = c.padrao.trim();
  if (/^nextval\(/.test(d)) return '@default(autoincrement())';
  if (ti.tipo === 'DateTime' && !ti.lista && /^(now\(\)|CURRENT_TIMESTAMP)$/i.test(d)) return '@default(now())';
  if (ti.tipo === 'Boolean' && !ti.lista && /^(true|false)$/.test(d)) return `@default(${d})`;
  if (NUMERICO.has(ti.tipo) && !ti.lista) {
    const n = d.replace(/::[a-z ]+(\(\d+(,\d+)?\))?$/i, '').replace(/^\((.*)\)$/, '$1').replace(/^'(.*)'$/, '$1');
    if (/^-?\d+(\.\d+)?$/.test(n) && (ti.tipo !== 'Int' && ti.tipo !== 'BigInt' || /^-?\d+$/.test(n))) return `@default(${n})`;
  }
  const lit = d.match(/^'((?:[^']|'')*)'::[\w ."]+?(\[\])?$/);
  if (lit) {
    const v = lit[1].replace(/''/g, "'");
    if (ti.lista) { if (v === '{}') return '@default([])'; }
    else if (ti.enumPg) { const nome = enums.get(ti.enumPg).valores.get(v); if (nome) return `@default(${nome})`; }
    else if (ti.tipo === 'String' || ti.tipo === 'Json') return `@default(${JSON.stringify(v)})`;
  }
  return `@default(dbgenerated(${JSON.stringify(d)}))`;
}

const ACAO = { a: 'NoAction', r: 'Restrict', c: 'Cascade', n: 'SetNull', d: 'SetDefault' };
const mesmaLista = (a, b) => a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0');
const idValido = (s) => /^[A-Za-z][A-Za-z0-9_]*$/.test(s);

function nomeLivre(usados, base) {
  let nome = base;
  if (usados.has(nome)) nome = base + 'Rel';
  for (let i = 2; usados.has(nome); i++) nome = base + 'Rel' + i;
  usados.add(nome);
  return nome;
}

export function gerarSchema(catalogo) {
  const tabelas = catalogo.tabelas.filter((t) => !EXCLUIR.test(t.nome));
  const excluidas = catalogo.tabelas.filter((t) => EXCLUIR.test(t.nome)).map((t) => t.nome);

  // Nomes de modelo primeiro: enum não pode repetir nome de modelo.
  const modelos = new Map();
  const nomesModelo = new Set();
  for (const t of tabelas) {
    let nome = pascal(t.nome, true);
    if (!idValido(nome) || nomesModelo.has(nome)) nome = pascal(t.nome);
    nomesModelo.add(nome);
    modelos.set(t.nome, { t, nome, usados: new Set(), campos: [], relacoes: [], blocos: [], doc: [] });
  }

  const enums = new Map();
  for (const e of catalogo.enums || []) {
    let nome = pascal(e.nome);
    if (nomesModelo.has(nome)) nome += 'Enum';
    const valores = new Map();
    const linhas = [];
    const vistos = new Set();
    for (const rotulo of e.valores) {
      let v = rotulo;
      if (!idValido(v)) { v = rotulo.replace(/[^A-Za-z0-9_]/g, '_'); if (!/^[A-Za-z]/.test(v)) v = 'V_' + v; }
      while (vistos.has(v)) v += '_';
      vistos.add(v);
      valores.set(rotulo, v);
      linhas.push(v === rotulo ? `  ${v}` : `  ${v} @map(${JSON.stringify(rotulo)})`);
    }
    enums.set(e.nome, { nome, valores, linhas, pg: e.nome });
  }

  // Campos escalares, chave e unicidades.
  for (const m of modelos.values()) {
    const { t } = m;
    const pk = t.restricoes.find((r) => r.tipo === 'p');
    const unicos = [
      ...t.restricoes.filter((r) => r.tipo === 'u').map((r) => ({ nome: r.nome, colunas: r.colunas })),
      ...t.indices.filter((i) => i.unico && !i.parcial && !i.expressao).map((i) => ({ nome: i.nome, colunas: i.colunas.map((c) => c.c) })),
    ];
    m.unicos = [...(pk ? [{ nome: pk.nome, colunas: pk.colunas, pk: true }] : []), ...unicos];
    m.ignorado = m.unicos.length === 0;
    m.campo = new Map();
    for (const c of t.colunas) {
      let nome = /^[a-z][a-z0-9_]*$/.test(c.nome) ? camel(c.nome) : c.nome;
      if (!idValido(nome) || m.usados.has(nome)) nome = c.nome;
      m.usados.add(nome);
      m.campo.set(c.nome, nome);
    }
    for (const c of t.colunas) {
      const nome = m.campo.get(c.nome);
      const ti = tipoPrisma(c, enums);
      const attrs = [];
      if (pk && pk.colunas.length === 1 && pk.colunas[0] === c.nome) attrs.push(pk.nome === `${t.nome}_pkey` ? '@id' : `@id(map: ${JSON.stringify(pk.nome)})`);
      const u1 = unicos.find((u) => u.colunas.length === 1 && u.colunas[0] === c.nome);
      if (u1 && !(pk && pk.colunas.length === 1 && pk.colunas[0] === c.nome)) {
        attrs.push(u1.nome === `${t.nome}_${c.nome}_key` ? '@unique' : `@unique(map: ${JSON.stringify(u1.nome)})`);
      }
      const padrao = padraoPrisma(c, ti, enums);
      if (padrao) attrs.push(padrao);
      if (nome !== c.nome) attrs.push(`@map(${JSON.stringify(c.nome)})`);
      if (ti.nativo) attrs.push(ti.nativo);
      const doc = [];
      if (c.gerada) doc.push(`  /// coluna gerada pelo banco (somente leitura): ${c.padrao}`);
      const fk = t.restricoes.find((r) => r.tipo === 'f' && r.ref_schema !== 'public' && r.colunas.length === 1 && r.colunas[0] === c.nome);
      if (fk) doc.push(`  /// referencia ${fk.ref_schema}.${fk.ref_tabela}(${fk.ref_colunas.join(', ')})`);
      const opcional = !c.obrigatorio && !ti.lista ? '?' : '';
      m.campos.push({ doc, linha: `  ${nome} ${ti.tipo}${ti.lista ? '[]' : opcional} ${attrs.join(' ')}`.trimEnd() });
    }
    const multi = unicos.filter((u) => u.colunas.length > 1);
    if (pk && pk.colunas.length > 1) {
      const campos = pk.colunas.map((c) => m.campo.get(c)).join(', ');
      m.blocos.push(pk.nome === `${t.nome}_pkey` ? `  @@id([${campos}])` : `  @@id([${campos}], map: ${JSON.stringify(pk.nome)})`);
    }
    for (const u of multi) {
      const campos = u.colunas.map((c) => m.campo.get(c)).join(', ');
      m.blocos.push(u.nome === `${t.nome}_${u.colunas.join('_')}_key` ? `  @@unique([${campos}])` : `  @@unique([${campos}], map: ${JSON.stringify(u.nome)})`);
    }
    for (const i of t.indices.filter((x) => !x.unico && !x.parcial && !x.expressao)) {
      const campos = i.colunas.map((c) => (c.desc ? `${m.campo.get(c.c)}(sort: Desc)` : m.campo.get(c.c))).join(', ');
      m.blocos.push(i.nome === `${t.nome}_${i.colunas.map((c) => c.c).join('_')}_idx` ? `  @@index([${campos}])` : `  @@index([${campos}], map: ${JSON.stringify(i.nome)})`);
    }
    const parciais = t.indices.filter((i) => i.parcial || i.expressao).map((i) => i.nome);
    const checks = t.restricoes.filter((r) => r.tipo === 'c').length;
    m.doc.push(`/// Tabela public.${t.nome}${t.rls ? ' — RLS ligado' : ''}.`);
    if (t.gatilhos?.length) m.doc.push(`/// Gatilhos: ${t.gatilhos.join(', ')}.`);
    if (checks) m.doc.push(`/// ${checks} check constraint(s) só no SQL.`);
    if (parciais.length) m.doc.push(`/// Índices parciais/por expressão só no SQL: ${parciais.join(', ')}.`);
  }

  // Relações: nome da relação = nome da FK, sempre explícito (sem ambiguidade).
  const nomesRelacao = new Set();
  const pendentes = [];
  for (const m of modelos.values()) {
    for (const fk of m.t.restricoes.filter((r) => r.tipo === 'f' && r.ref_schema === 'public')) {
      const alvo = modelos.get(fk.ref_tabela);
      if (!alvo || alvo.ignorado || m.ignorado) { m.doc.push(`/// FK ${fk.nome} sem relação Prisma (modelo ignorado ou excluído).`); continue; }
      if (!alvo.unicos.some((u) => mesmaLista(u.colunas, fk.ref_colunas))) { m.doc.push(`/// FK ${fk.nome} sem relação Prisma (referência não é única no Prisma).`); continue; }
      let rel = fk.nome;
      if (nomesRelacao.has(rel)) rel = `${m.t.nome}_${fk.nome}`;
      nomesRelacao.add(rel);
      const colunas = fk.colunas;
      const base = colunas.length === 1
        ? (colunas[0].endsWith('_id') && colunas[0] !== 'id' ? camel(colunas[0].slice(0, -3)) : camel(colunas[0] + '_rel'))
        : camel(alvo.t.nome.split('_').map(singular).join('_'));
      const campo = nomeLivre(m.usados, base);
      const opcional = colunas.some((c) => !m.t.colunas.find((x) => x.nome === c).obrigatorio);
      let onDelete = ACAO[fk.on_delete] ?? 'NoAction';
      if (onDelete === 'SetNull' && !opcional) { onDelete = 'NoAction'; m.doc.push(`/// FK ${fk.nome}: ON DELETE SET NULL em coluna obrigatória; no Prisma fica NoAction.`); }
      const onUpdate = ACAO[fk.on_update] ?? 'NoAction';
      const mapa = fk.nome === `${m.t.nome}_${colunas.join('_')}_fkey` ? '' : `, map: ${JSON.stringify(fk.nome)}`;
      m.relacoes.push(`  ${campo} ${alvo.nome}${opcional ? '?' : ''} @relation(${JSON.stringify(rel)}, fields: [${colunas.map((c) => m.campo.get(c)).join(', ')}], references: [${fk.ref_colunas.map((c) => alvo.campo.get(c)).join(', ')}], onDelete: ${onDelete}, onUpdate: ${onUpdate}${mapa})`);
      const umParaUm = m.unicos.some((u) => mesmaLista(u.colunas, colunas));
      pendentes.push({ alvo, filho: m, rel, campo, umParaUm });
    }
  }
  // Relação de volta: plural vem do próprio nome da tabela (já está no plural).
  const porPar = new Map();
  for (const p of pendentes) { const k = p.alvo.nome + '>' + p.filho.nome; porPar.set(k, (porPar.get(k) || 0) + 1); }
  for (const p of pendentes) {
    const varias = porPar.get(p.alvo.nome + '>' + p.filho.nome) > 1 || p.alvo === p.filho;
    let base = p.umParaUm ? camel(p.filho.t.nome.split('_').map(singular).join('_')) : camel(p.filho.t.nome);
    if (varias) base += cap(p.campo);
    const nome = nomeLivre(p.alvo.usados, base);
    p.alvo.relacoes.push(`  ${nome} ${p.filho.nome}${p.umParaUm ? '?' : '[]'} @relation(${JSON.stringify(p.rel)})`);
  }

  const saida = [
    '// GERADO das migrations (npm run schema:gerar) por api/scripts/schema/gerar-schema.mjs.',
    '// Não edite à mão: mudança de banco é migration SQL em prisma/migrations; depois',
    '// rode o gerador de novo. NUNCA rodar prisma migrate dev, db push ou db pull contra',
    '// a produção. Funções, gatilhos, RLS e checks existem só nas migrations SQL.',
    `// Fora do Prisma: tabelas ${excluidas.join(', ') || '(nenhuma)'}; views ${(catalogo.views || []).join(', ') || '(nenhuma)'}.`,
    '',
    'generator client {',
    '  provider = "prisma-client-js"',
    '}',
    '',
    'datasource db {',
    '  provider = "postgresql"',
    '  url      = env("DATABASE_URL")',
    '  // Migrations precisam de conexão direta (o pooler de transação não serve).',
    '  directUrl = env("DIRECT_URL")',
    '}',
    '',
  ];
  for (const e of [...enums.values()].sort((a, b) => a.nome.localeCompare(b.nome))) {
    saida.push(`enum ${e.nome} {`, ...e.linhas, '');
    if (e.nome !== e.pg) saida.push(`  @@map(${JSON.stringify(e.pg)})`);
    saida.push('}', '');
  }
  for (const m of [...modelos.values()].sort((a, b) => a.nome.localeCompare(b.nome))) {
    saida.push(...m.doc, `model ${m.nome} {`);
    for (const c of m.campos) saida.push(...c.doc, c.linha);
    if (m.relacoes.length) saida.push('', ...m.relacoes);
    const fim = [...m.blocos];
    if (m.nome !== m.t.nome) fim.push(`  @@map(${JSON.stringify(m.t.nome)})`);
    if (m.ignorado) fim.push('  @@ignore');
    if (fim.length) saida.push('', ...fim);
    saida.push('}', '');
  }
  return saida.join('\n');
}

// A saída do `supabase db query` envolve o resultado em { rows: [...] }.
export function lerCatalogo(texto) {
  const json = JSON.parse(texto.slice(texto.indexOf('{')));
  return json.rows ? json.rows[0].catalogo : json;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [entrada, destino] = process.argv.slice(2);
  if (!entrada || !destino) { console.error('uso: node gerar-schema.mjs catalogo.json schema.prisma'); process.exit(1); }
  writeFileSync(destino, gerarSchema(lerCatalogo(readFileSync(entrada, 'utf8'))));
  console.log('schema gerado em', destino);
}
