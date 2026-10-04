// Confere se a produção mudou por fora das migrations: gera o schema a partir do
// catálogo da produção e compara com o prisma/schema.prisma (que sai das
// migrations). Diferença = alguém alterou o banco direto; vira migration.
//
// Uso:
//   supabase db query --linked -f api/scripts/schema/catalogo.sql > catalogo.json
//   node api/scripts/schema/conferir-producao.mjs catalogo.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gerarSchema, lerCatalogo } from './gerar-schema.mjs';

const norm = (t) => t.split('\n').filter((l) => !l.startsWith('// ')).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

export function diferencas(producao, commitado) {
  const a = norm(producao);
  const b = norm(commitado);
  return { soNaProducao: a.filter((l) => !b.includes(l)), soNasMigrations: b.filter((l) => !a.includes(l)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [arquivo] = process.argv.slice(2);
  if (!arquivo) { console.error('uso: node conferir-producao.mjs catalogo.json'); process.exit(1); }
  const producao = gerarSchema(lerCatalogo(readFileSync(arquivo, 'utf8')));
  const commitado = readFileSync(fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)), 'utf8');
  const d = diferencas(producao, commitado);
  if (!d.soNaProducao.length && !d.soNasMigrations.length) { console.log('produção igual às migrations'); process.exit(0); }
  console.log('Só na produção (mudou por fora das migrations):\n' + d.soNaProducao.join('\n'));
  console.log('\nSó nas migrations (ainda não aplicado na produção):\n' + d.soNasMigrations.join('\n'));
  process.exit(1);
}
