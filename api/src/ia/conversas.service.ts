import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { AlterarConversaDto } from './ia.dto';
import { erroApi, traduzirErroBanco } from './ia.erros';

export type Linha = Record<string, unknown>;
export type Tx = Prisma.TransactionClient;

/** Mesmo .limit(50) de useAIChat.loadConversations. */
export const LIMITE_CONVERSAS = 50;
/** max_rows do PostgREST: o teto implícito da leitura de mensagens no Supabase. */
export const LIMITE_MENSAGENS = 1000;

const CONVERSA_NAO_ENCONTRADA = () => erroApi(404, 'conversa_nao_encontrada', 'Conversa não encontrada.');

// ---------------------------------------------------------------- SQL compartilhado (dentro de um run)

export async function corretorDaSessao(tx: Tx): Promise<string | null> {
  const linhas = await tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`select public.get_corretor_id()::text as id`);
  return linhas[0]?.id ?? null;
}

export async function criarConversa(tx: Tx, corretorId: string, modelo: string): Promise<string> {
  const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    insert into public.ai_conversations (corretor_id, model) values (${corretorId}::uuid, ${modelo}::text)
    returning id::text as id`);
  return linhas[0].id;
}

/** A conversa é visível para quem pede (RLS)? */
export async function conversaVisivel(tx: Tx, id: string): Promise<boolean> {
  const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    select count(*)::int as n from public.ai_conversations where id = ${id}::uuid`);
  return n > 0;
}

export interface NovaMensagem {
  conversationId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: unknown;
  toolName?: string | null;
  metadata?: unknown;
}

export async function inserirMensagem(tx: Tx, m: NovaMensagem): Promise<string> {
  const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    insert into public.ai_messages (conversation_id, role, content, tool_calls, tool_name, metadata)
    values (${m.conversationId}::uuid, ${m.role}::text, ${m.content}::text,
      ${m.toolCalls === undefined ? null : JSON.stringify(m.toolCalls)}::jsonb, ${m.toolName ?? null}::text,
      ${m.metadata === undefined ? null : JSON.stringify(m.metadata)}::jsonb)
    returning id::text as id`);
  return linhas[0].id;
}

export interface LinhaHistorico {
  role: string;
  content: string;
  tool_calls: unknown;
  tool_name: string | null;
}

/** As últimas N mensagens, da mais nova para a mais antiga (como a Edge Function). */
export async function historicoRecente(tx: Tx, conversationId: string, limite: number): Promise<LinhaHistorico[]> {
  return tx.$queryRaw<LinhaHistorico[]>(Prisma.sql`
    select m.role, m.content, m.tool_calls, m.tool_name from public.ai_messages m
    where m.conversation_id = ${conversationId}::uuid
    order by m.created_at desc nulls last, m.id desc
    limit ${limite}::int`);
}

// ---------------------------------------------------------------- rotas de conversa

/** Conversas do Assistente (ai_conversations / ai_messages), sempre com as claims de quem pede (RLS). */
@Injectable()
export class ConversasService {
  constructor(private readonly db: TenantDb) {}

  async listar(claims: SupabaseClaims): Promise<Linha[]> {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(c) as linha from public.ai_conversations c
        order by c.updated_at desc nulls first, c.id
        limit ${LIMITE_CONVERSAS}::int`));
      return linhas.map((l) => l.linha);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  /** Renomear ou fixar: só as colunas enviadas (o Supabase não mexia em updated_at aqui). */
  async alterar(claims: SupabaseClaims, id: string, dto: AlterarConversaDto): Promise<Linha> {
    const titulo = typeof dto.title === 'string' ? dto.title.trim() : undefined;
    if (titulo === '') throw erroApi(400, 'titulo_invalido', 'Informe o título da conversa.');
    if (titulo === undefined && dto.pinned === undefined) throw erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.');
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update public.ai_conversations c set
          title = coalesce(${titulo ?? null}::text, c.title),
          pinned = coalesce(${dto.pinned ?? null}::boolean, c.pinned)
        where c.id = ${id}::uuid
        returning to_jsonb(c) as linha`));
      if (linhas.length === 0) throw CONVERSA_NAO_ENCONTRADA();
      return linhas[0].linha;
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  /** Idempotente, como o delete do PostgREST: o que o RLS não deixa ver simplesmente não é apagado. */
  async apagar(claims: SupabaseClaims, id: string): Promise<void> {
    try {
      await this.db.run(claims, (tx) => tx.$queryRaw(Prisma.sql`
        delete from public.ai_conversations where id = ${id}::uuid returning id`));
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  async mensagens(claims: SupabaseClaims, id: string): Promise<Linha[]> {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(m) as linha from public.ai_messages m
        where m.conversation_id = ${id}::uuid
        order by m.created_at asc nulls last, m.id
        limit ${LIMITE_MENSAGENS}::int`));
      return linhas.map((l) => l.linha);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }
}
