// Marca uma migration como já aplicada num banco que já tem o schema (a produção
// no Supabase), sem executar nada dela. É o mesmo efeito de
// `prisma migrate resolve --applied <nome>`, que exigiria a senha do banco.
// A tabela de controle é a mesma que o Prisma cria; o checksum é o SHA-256 dos
// bytes do migration.sql (por isso as migrations são sempre LF, ver .gitattributes).
//
// Uso:
//   node api/scripts/schema/marcar-baseline.mjs api/prisma/migrations/0_init/migration.sql > marcar.sql
//   supabase db query --linked -f marcar.sql
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function sqlMarcarAplicada(nome, soma) {
  if (!/^[0-9a-z_]+$/.test(nome) || !/^[0-9a-f]{64}$/.test(soma)) throw new Error('nome ou checksum inválido');
  return `-- Equivale a: prisma migrate resolve --applied ${nome}
CREATE TABLE IF NOT EXISTS public._prisma_migrations (
  id character varying(36) NOT NULL PRIMARY KEY,
  checksum character varying(64) NOT NULL,
  finished_at timestamp with time zone,
  migration_name character varying(255) NOT NULL,
  logs text,
  rolled_back_at timestamp with time zone,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  applied_steps_count integer NOT NULL DEFAULT 0
);
-- Controle interno: fora do alcance da API pública do Supabase.
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._prisma_migrations FROM anon, authenticated, service_role;
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '${soma}', now(), '${nome}', now(), 0
WHERE NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '${nome}' AND rolled_back_at IS NULL);
SELECT migration_name, checksum, finished_at IS NOT NULL AS aplicada,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public._prisma_migrations'::regclass) AS rls
FROM public._prisma_migrations ORDER BY started_at;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [arquivo] = process.argv.slice(2);
  if (!arquivo) { console.error('uso: node marcar-baseline.mjs prisma/migrations/<nome>/migration.sql'); process.exit(1); }
  const bytes = readFileSync(arquivo);
  if (bytes.includes(13)) { console.error('migration.sql com CRLF: o checksum não bateria com o do Prisma no Linux.'); process.exit(1); }
  process.stdout.write(sqlMarcarAplicada(basename(dirname(arquivo)), checksum(bytes)));
}
