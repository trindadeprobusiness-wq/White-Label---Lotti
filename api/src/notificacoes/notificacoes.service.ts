import { Injectable } from '@nestjs/common';
import { Alerta } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';

/** O mesmo formato que o sino recebe hoje do Supabase (colunas do banco). */
export interface AlertaSino {
  id: string;
  cliente_id: string | null;
  corretor_id: string;
  tipo: string;
  mensagem: string;
  metadata: unknown;
  lido: boolean;
  created_at: string;
  read_at: string | null;
  origem: string | null;
  entidade_tipo: string | null;
  entidade_id: string | null;
}

export function paraSino(a: Alerta): AlertaSino {
  return {
    id: a.id,
    cliente_id: a.clienteId,
    corretor_id: a.corretorId,
    tipo: a.tipo,
    mensagem: a.mensagem,
    metadata: a.metadata,
    lido: a.lido,
    created_at: a.createdAt.toISOString(),
    read_at: a.readAt ? a.readAt.toISOString() : null,
    origem: a.origem,
    entidade_tipo: a.entidadeTipo,
    entidade_id: a.entidadeId,
  };
}

@Injectable()
export class NotificacoesService {
  constructor(private readonly db: TenantDb) {}

  async listar(claims: SupabaseClaims, limite = 200): Promise<AlertaSino[]> {
    const linhas = await this.db.run(claims, (tx) => tx.alerta.findMany({ orderBy: { createdAt: 'desc' }, take: limite }));
    return linhas.map(paraSino);
  }

  /** Mesma função do banco que o sino usa hoje; sem ids, marca todas. */
  async marcarLidas(claims: SupabaseClaims, ids?: string[]): Promise<number> {
    const linhas = await this.db.run(claims, (tx) =>
      tx.$queryRaw<Array<{ n: number }>>`select public.marcar_alertas_lidos(${ids ?? null}::uuid[]) as n`,
    );
    return Number(linhas[0]?.n ?? 0);
  }

  async corretorId(claims: SupabaseClaims): Promise<string | null> {
    const linhas = await this.db.run(claims, (tx) =>
      tx.$queryRaw<Array<{ id: string | null }>>`select public.get_corretor_id()::text as id`,
    );
    return linhas[0]?.id ?? null;
  }
}
