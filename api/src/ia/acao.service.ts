import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { validarProposta } from './acoes';
import { corretorDaSessao } from './conversas.service';
import type { ClienteSql } from './cotas';
import { executarAcao, ResultadoAcao } from './executar-acao';
import { DecisaoAcaoDto } from './ia.dto';
import { codigoDe, erroApi, traduzirErroBanco } from './ia.erros';

interface Proposta {
  id: string;
  status: string;
  expires_at: Date | string;
  payload: Record<string, unknown>;
}

export type RespostaAcao =
  | { status: 'rejected'; proposal_id: string }
  | ({ status: 'executed'; proposal_id: string; idempotent?: true } & ResultadoAcao);

const NAO_EXECUTADA = () => erroApi(500, 'acao_nao_executada', 'A ação não foi executada. Revise os dados e tente novamente.');

/**
 * Porte do ai-action. A proposta (ai_action_proposals: só o service_role escreve) é lida e travada pelo
 * PrismaService, sempre filtrada pelo corretor e pelo usuário da sessão. A escrita da ação roda no
 * TenantDb com as claims do usuário (RLS das telas). A tabela vem da migration do gateway: sem ela,
 * toda proposta responde 404, como a função responderia.
 */
@Injectable()
export class AcaoIaService {
  private readonly log = new Logger('IaAcao');

  constructor(private readonly db: TenantDb, private readonly prisma: PrismaService) {}

  private get sql(): ClienteSql {
    return this.prisma as unknown as ClienteSql;
  }

  async decidir(claims: SupabaseClaims, dto: DecisaoAcaoDto): Promise<RespostaAcao> {
    let corretorId: string | null;
    try {
      corretorId = await this.db.run(claims, corretorDaSessao);
    } catch (e) {
      traduzirErroBanco(e);
    }
    if (!corretorId) throw erroApi(403, 'corretor_nao_identificado', 'Corretor não encontrado.');
    const proposalId = dto.proposal_id;

    let atual: Proposta | undefined;
    try {
      const r = await this.sql.$queryRaw<Proposta[]>(Prisma.sql`
        select id::text as id, status, expires_at, payload from public.ai_action_proposals
        where id = ${proposalId}::uuid and corretor_id = ${corretorId}::uuid and user_id = ${claims.sub}::uuid`);
      atual = r[0];
    } catch (e) {
      this.log.warn(`proposta não lida ${codigoDe(e)}`);
    }
    if (!atual) throw erroApi(404, 'proposta_nao_encontrada', 'Proposta não encontrada.');

    if (dto.decision === 'reject') {
      if (atual.status !== 'pending') throw erroApi(409, 'proposta_processada', 'A proposta já foi processada.');
      try {
        await this.sql.$executeRaw(Prisma.sql`
          update public.ai_action_proposals set status = 'rejected', updated_at = now()
          where id = ${proposalId}::uuid and status = 'pending'`);
      } catch (e) {
        this.log.error(`proposta não recusada ${codigoDe(e)}`);
        throw erroApi(500, 'recusa_falhou', 'Não foi possível recusar a proposta.');
      }
      return { status: 'rejected', proposal_id: proposalId };
    }

    if (atual.status === 'executed') return { status: 'executed', proposal_id: proposalId, idempotent: true };
    if (atual.status !== 'pending' || new Date(atual.expires_at) <= new Date()) {
      throw erroApi(409, 'proposta_expirada', 'A proposta expirou ou já foi processada.');
    }

    let travada: Proposta | undefined;
    try {
      const r = await this.sql.$queryRaw<Proposta[]>(Prisma.sql`
        update public.ai_action_proposals set status = 'confirmed', confirmed_at = now(), updated_at = now()
        where id = ${proposalId}::uuid and status = 'pending' and expires_at > now()
        returning id::text as id, status, expires_at, payload`);
      travada = r[0];
    } catch (e) {
      this.log.warn(`proposta não travada ${codigoDe(e)}`);
    }
    if (!travada) throw erroApi(409, 'proposta_processada', 'A proposta já foi processada.');

    try {
      const proposta = validarProposta(travada.payload);
      const resultado = await this.db.run(claims, (tx) => executarAcao(tx, corretorId, proposta));
      await this.sql.$executeRaw(Prisma.sql`
        update public.ai_action_proposals set status = 'executed', executed_at = now(), updated_at = now()
        where id = ${proposalId}::uuid and status = 'confirmed'`).catch((e) => this.log.error(`proposta executada sem marca ${codigoDe(e)}`));
      return { status: 'executed', proposal_id: proposalId, ...resultado };
    } catch (e) {
      this.log.error(`ai-action falhou ${e instanceof HttpException ? e.getStatus() : codigoDe(e)}`);
      await this.sql.$executeRaw(Prisma.sql`
        update public.ai_action_proposals set status = 'failed', error_code = 'execution_failed', updated_at = now()
        where id = ${proposalId}::uuid and status = 'confirmed'`).catch((err) => this.log.error(`proposta sem marca de falha ${codigoDe(err)}`));
      throw NAO_EXECUTADA();
    }
  }
}
