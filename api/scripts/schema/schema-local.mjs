// Gera o schema.prisma a partir das migrations, num Postgres local (PGlite), sem
// tocar a produção: aplica prisma/migrations/* em ordem, lê o catálogo com o
// mesmo catalogo.sql e escreve com o mesmo gerador. Assim a migration e o schema
// entram juntos no mesmo PR, antes de qualquer deploy.
//
// Uso: node scripts/schema/schema-local.mjs [destino]   (padrão: prisma/schema.prisma)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { gerarSchema } from './gerar-schema.mjs';

const aqui = (p) => fileURLToPath(new URL(p, import.meta.url));

export async function catalogoLocal() {
  const pasta = aqui('../../prisma/migrations/');
  const nomes = readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  try {
    for (const nome of nomes) await db.exec(readFileSync(join(pasta, nome, 'migration.sql'), 'utf8'));
    const consulta = readFileSync(aqui('./catalogo.sql'), 'utf8');
    const resultados = await db.exec(consulta);
    return resultados.at(-1).rows[0].catalogo;
  } finally {
    await db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destino = process.argv[2] || aqui('../../prisma/schema.prisma');
  writeFileSync(destino, gerarSchema(await catalogoLocal()));
  console.log('schema gerado das migrations em', destino, '— rode `npx prisma format` em seguida');
}
