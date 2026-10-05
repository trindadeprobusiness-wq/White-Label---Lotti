import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';

export type GrupoPrivado = 'documento' | 'anexo-ia';
export type BucketInbox = 'lotti-inbox-files' | 'lotti-inbox-audio';

type Um = Array<{ ok: number }>;

/**
 * Pergunta ao banco, já dentro do TenantDb (RLS + claims, igual ao PostgREST), se existe uma linha
 * VISÍVEL para quem pede que aponte para esta key. É a fonte da verdade do dono: a API não refaz a
 * política, só pergunta "existe?". A key entra sempre como parâmetro (Prisma.sql), nunca concatenada,
 * com ::text e limit 1. Vazio → o controller responde 403.
 */
@Injectable()
export class ArquivosRepo {
  constructor(private readonly db: TenantDb) {}

  /** get_corretor_id() de quem pede, para montar o prefixo de upload dos buckets privados. */
  async corretorId(claims: SupabaseClaims): Promise<string | null> {
    const linhas = await this.db.run(claims, (tx) =>
      tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`select get_corretor_id()::text as id`),
    );
    return linhas[0]?.id ?? null;
  }

  /** documento: linha visível em documentos (arquivo_path) OU em contratos (arquivo_url). */
  async donoDocumento(claims: SupabaseClaims, key: string): Promise<boolean> {
    const linhas = await this.db.run(claims, (tx) =>
      tx.$queryRaw<Um>(Prisma.sql`
        select 1 as ok from public.documentos where arquivo_path = ${key}::text
        union all
        select 1 as ok from public.contratos where arquivo_url = ${key}::text
        limit 1`),
    );
    return linhas.length > 0;
  }

  /** anexo-ia: linha visível em ai_attachments (storage_path). */
  async donoAnexoIa(claims: SupabaseClaims, key: string): Promise<boolean> {
    const linhas = await this.db.run(claims, (tx) =>
      tx.$queryRaw<Um>(Prisma.sql`
        select 1 as ok from public.ai_attachments where storage_path = ${key}::text limit 1`),
    );
    return linhas.length > 0;
  }

  /** inbox: linha visível em lotti_agent_messages OU lotti_manual_sends (media_path). */
  async donoInbox(claims: SupabaseClaims, key: string): Promise<boolean> {
    const linhas = await this.db.run(claims, (tx) =>
      tx.$queryRaw<Um>(Prisma.sql`
        select 1 as ok from public.lotti_agent_messages where media_path = ${key}::text
        union all
        select 1 as ok from public.lotti_manual_sends where media_path = ${key}::text
        limit 1`),
    );
    return linhas.length > 0;
  }
}
