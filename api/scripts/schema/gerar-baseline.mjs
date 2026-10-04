// Monta api/prisma/migrations/0_init/migration.sql a partir da saída de ddl.sql.
// Usado uma vez (2026-10-04): a 0_init está MARCADA como aplicada na produção e
// congelada. Na produção ela nunca roda:
// ela serve para criar bancos novos idênticos (ensaio no Railway, shadow DB).
//
// Uso:
//   supabase db query --linked -f api/scripts/schema/ddl.sql > ddl.json
//   node api/scripts/schema/gerar-baseline.mjs ddl.json api/prisma/migrations/0_init/migration.sql
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECOES = {
  10: 'Enums', 20: 'Tabelas', 30: 'Funções', 35: 'Padrões que chamam funções', 40: 'Chaves e unicidades',
  41: 'Checks', 45: 'Chaves estrangeiras', 50: 'Índices', 60: 'Views', 70: 'Gatilhos', 71: 'Gatilho do cadastro (auth.users)',
  80: 'RLS ligado', 85: 'Policies', 90: 'Uso dos schemas', 91: 'Permissões de tabela', 92: 'Permissões por coluna',
  93: 'Permissões de sequência', 94: 'Permissões de função', 95: 'Realtime',
};

// O que o Supabase já traz e um Postgres comum não tem. Só cria o que faltar:
// no Supabase nada aqui muda, e auth.uid()/role()/jwt() leem as mesmas claims
// (request.jwt.claims) que o PostgREST e o TenantDb da API aplicam.
export const COMPAT = `-- ===== Compatibilidade com o Supabase (só age fora dele) =====
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS suporte_privado;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- Colunas de auth.users que as funções do sistema leem. O login próprio (fase 5)
-- substitui esta tabela.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid NOT NULL PRIMARY KEY,
  aud character varying(255),
  role character varying(255),
  email character varying(255),
  encrypted_password character varying(255),
  email_confirmed_at timestamp with time zone,
  invited_at timestamp with time zone,
  last_sign_in_at timestamp with time zone,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  phone text,
  banned_until timestamp with time zone,
  is_anonymous boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone
);

DO $do$ BEGIN
  IF to_regprocedure('auth.jwt()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $b$
      SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
    $b$$f$;
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $b$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $b$$f$;
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $b$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')::text
    $b$$f$;
  END IF;
  IF to_regprocedure('auth.email()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $b$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.email', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')::text
    $b$$f$;
  END IF;
END $do$;
`;

export function montarBaseline(linhas, { geradoEm = new Date().toISOString().slice(0, 10) } = {}) {
  const partes = [
    '-- 0_init: baseline da Lotti extraída do banco de produção (catálogo do Postgres 17).',
    `-- Gerada em ${geradoEm} por api/scripts/schema/gerar-baseline.mjs. NÃO editar à mão.`,
    '-- Na produção (Supabase) está marcada como aplicada e nunca roda. Serve para criar',
    '-- bancos novos idênticos ao de produção (ensaio no Railway, shadow DB).',
    '-- Fora, de propósito:',
    '--   - dados;',
    '--   - storage (vai para R2);',
    '--   - pg_cron, pg_net e Vault (agendamentos vão para @nestjs/schedule; segredos nunca vão ao repo);',
    '--   - tabelas de backup _*;',
    '--   - autovacuum desligado em 4 tabelas da produção;',
    '--   - privilégio MAINTAIN (só existe no PG17+).',
    '',
    'SET check_function_bodies = false;',
    'SET client_min_messages = warning;',
    '',
    COMPAT,
  ];
  let atual = null;
  for (const l of linhas) {
    if (l.ordem !== atual) {
      atual = l.ordem;
      partes.push('', `-- ===== ${SECOES[l.ordem] ?? `Seção ${l.ordem}`} =====`, '');
    }
    partes.push(l.sql, '');
  }
  return partes.join('\n').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function lerLinhas(texto) {
  const json = JSON.parse(texto.slice(texto.indexOf('{')));
  if (!Array.isArray(json.rows)) throw new Error('saída do ddl.sql sem rows: ' + texto.slice(0, 300));
  return json.rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [entrada, destino] = process.argv.slice(2);
  if (!entrada || !destino) { console.error('uso: node gerar-baseline.mjs ddl.json migration.sql'); process.exit(1); }
  // A 0_init já está marcada como aplicada na produção (checksum registrado):
  // reescrevê-la quebraria o histórico. Para comparar, gere em outro caminho.
  if (existsSync(destino)) { console.error(`${destino} já existe e está congelada. Gere em outro caminho para comparar.`); process.exit(1); }
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, montarBaseline(lerLinhas(readFileSync(entrada, 'utf8'))));
  console.log('baseline gerada em', destino);
}
