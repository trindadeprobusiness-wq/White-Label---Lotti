// Confere o ensaio (DESTINO_URL) contra as migrations e contra a produção:
// 1. schema do destino = prisma/schema.prisma (o que as migrations geram);
// 2. contagem de linhas igual à da produção, tabela por tabela;
// 3. o que cada usuário enxerga pelo RLS (padrão TenantDb) é igual nos dois.
// Imprime só nomes e contagens, nunca conteúdo.
//
// Uso: node api/scripts/dados/conferir-ensaio.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { gerarSchema } from '../schema/gerar-schema.mjs';
import { diferencas } from '../schema/conferir-producao.mjs';
import { conferirContagens, origemSupabase, sqlVisaoDoUsuario } from './copiar.mjs';

const aqui = (p) => fileURLToPath(new URL(p, import.meta.url));
if (!process.env.DESTINO_URL) { console.error('defina DESTINO_URL'); process.exit(1); }
const origem = origemSupabase({ cwd: aqui('../../../') });
const destino = new pg.Client({ connectionString: process.env.DESTINO_URL, ssl: { rejectUnauthorized: false } });
await destino.connect();
let falhou = false;
try {
  const catalogo = (await destino.query(readFileSync(aqui('../schema/catalogo.sql'), 'utf8'))).rows[0].catalogo;
  const d = diferencas(gerarSchema(catalogo), readFileSync(aqui('../../prisma/schema.prisma'), 'utf8'));
  const schemaIgual = !d.soNaProducao.length && !d.soNasMigrations.length;
  console.log(schemaIgual ? '1. schema do ensaio = schema.prisma' : `1. SCHEMA DIFERENTE: ${JSON.stringify(d)}`);
  falhou ||= !schemaIgual;

  const conf = await conferirContagens({ origem, destino });
  console.log(conf.diferencas.length ? `2. CONTAGENS DIFERENTES: ${JSON.stringify(conf.diferencas)}` : `2. contagens iguais nas ${conf.tabelas} tabelas`);
  falhou ||= conf.diferencas.length > 0;

  const usuarios = (await destino.query('select id::text from auth.users order by created_at')).rows.map((r) => r.id);
  for (const [i, sub] of usuarios.entries()) {
    const naProducao = (await origem(sqlVisaoDoUsuario(sub)))[0];
    const noEnsaio = (await destino.query(sqlVisaoDoUsuario(sub)))
      .find?.((r) => r.rows?.[0] && 'clientes' in r.rows[0])?.rows[0];
    const igual = JSON.stringify(naProducao) === JSON.stringify(noEnsaio);
    console.log(`3. usuário ${i + 1}: ${igual ? 'mesma visão' : 'VISÃO DIFERENTE'} ${JSON.stringify(noEnsaio)}${igual ? '' : ' x produção ' + JSON.stringify(naProducao)}`);
    falhou ||= !igual;
  }
  const status = (await destino.query(`select count(*)::int as n, count(*) filter (where finished_at is not null and rolled_back_at is null)::int as ok from public._prisma_migrations`)).rows[0];
  console.log(`4. _prisma_migrations no ensaio: ${status.ok}/${status.n} aplicadas`);
} finally {
  await destino.end();
}
process.exit(falhou ? 1 : 0);
