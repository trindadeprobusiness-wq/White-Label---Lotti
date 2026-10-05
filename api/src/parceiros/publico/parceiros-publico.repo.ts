import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { Utm } from './utilitarios';

/**
 * Caminho do dono (contrato §0.2, item 2): o que as Edge Functions faziam com service_role e para o
 * que `authenticated`/`anon` NÃO têm grant. Conferido em 0_init: parceiro_cliques e
 * parceiro_atribuicoes dão a authenticated só REFERENCES, SELECT, TRIGGER, TRUNCATE.
 *
 * Nenhuma consulta daqui recebe parceiro_id, corretor_id ou percentual vindo do cliente: o cliente
 * manda só slug e visitante_id (opacos) e o user_id vem sempre de claims.sub.
 *
 * Cada comando é um $queryRaw/$executeRaw próprio, FORA de transação: não há run para abortar, então
 * o chamador pode engolir o erro do clique sem deixar transação suja.
 */
export interface LinkResolvido {
  link_id: string;
  parceiro_id: string;
  nome: string;
  janela_atribuicao_dias: number;
}

export interface AtribuicaoDoVisitante {
  id: string;
  expira_em: Date;
  status: string;
  user_id: string | null;
  parceiro_id: string;
  nome: string;
  parceiro_status: string;
  parceiro_email: string | null;
  parceiro_user_id: string | null;
}

export interface CorretorDoUsuario {
  id: string;
  email: string | null;
}

export interface DadosDoClique {
  linkId: string;
  parceiroId: string;
  visitanteId: string;
  ipHash: string | null;
  userAgent: string | null;
  referer: string | null;
  utm: Utm | null;
}

@Injectable()
export class ParceirosPublicoRepo {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Link ativo de parceiro ativo. As quatro condições que o TypeScript conferia depois do select
   * viraram `where` (contrato §6.1): resultado idêntico e um ramo menos para esquecer.
   */
  async resolverLink(slug: string): Promise<LinkResolvido | null> {
    const linhas = await this.prisma.$queryRaw<LinkResolvido[]>(Prisma.sql`
      select l.id::text as link_id, p.id::text as parceiro_id, p.nome, p.janela_atribuicao_dias
        from public.parceiro_links l
        join public.parceiros p on p.id = l.parceiro_id
       where l.slug = ${slug}::text and l.ativo and l.revogado_em is null and p.status = 'ativo'
       limit 1`);
    return linhas[0] ?? null;
  }

  registrarClique(d: DadosDoClique): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.parceiro_cliques (link_id, parceiro_id, visitante_id, ip_hash, user_agent, referer, utm)
      values (${d.linkId}::uuid, ${d.parceiroId}::uuid, ${d.visitanteId}::uuid, ${d.ipHash}::text,
              ${d.userAgent}::text, ${d.referer}::text, ${d.utm}::jsonb)`);
  }

  /**
   * O coração da regra: primeiro clique vence, pelo índice uq_atribuicao_visitante. O
   * `on conflict do nothing` substitui o "23505 esperado" de hoje — nada é sobrescrito, nunca.
   * A janela vem da coluna do parceiro e o prazo é calculado pelo banco (uma fonte de tempo só).
   */
  registrarAtribuicao(parceiroId: string, linkId: string, visitanteId: string, janela: number): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.parceiro_atribuicoes
        (parceiro_id, link_id, visitante_id, modelo, janela_dias, expira_em, status)
      values (${parceiroId}::uuid, ${linkId}::uuid, ${visitanteId}::uuid, 'primeiro_clique',
              ${janela}::int, now() + make_interval(days => ${janela}::int), 'pendente')
      on conflict (visitante_id) do nothing`);
  }

  async atribuicaoDoUsuario(userId: string): Promise<{ id: string } | null> {
    const linhas = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id::text as id from public.parceiro_atribuicoes where user_id = ${userId}::uuid limit 1`);
    return linhas[0] ?? null;
  }

  async atribuicaoDoVisitante(visitanteId: string): Promise<AtribuicaoDoVisitante | null> {
    const linhas = await this.prisma.$queryRaw<AtribuicaoDoVisitante[]>(Prisma.sql`
      select a.id::text as id, a.expira_em, a.status, a.user_id::text as user_id,
             p.id::text as parceiro_id, p.nome, p.status as parceiro_status,
             p.email as parceiro_email, p.user_id::text as parceiro_user_id
        from public.parceiro_atribuicoes a
        join public.parceiros p on p.id = a.parceiro_id
       where a.visitante_id = ${visitanteId}::uuid limit 1`);
    return linhas[0] ?? null;
  }

  async corretorDoUsuario(userId: string): Promise<CorretorDoUsuario | null> {
    const linhas = await this.prisma.$queryRaw<CorretorDoUsuario[]>(Prisma.sql`
      select id::text as id, email from public.corretores where user_id = ${userId}::uuid limit 1`);
    return linhas[0] ?? null;
  }

  /** Invalidar em vez de apagar: a tentativa fica registrada, o que importa quando é autoindicação. */
  invalidar(id: string, motivo: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      update public.parceiro_atribuicoes set status = 'invalidada', motivo_invalidacao = ${motivo}::text
       where id = ${id}::uuid`);
  }

  /** As duas guardas de corrida de hoje viraram where: a segunda chamada não sobrescreve a primeira. */
  async converter(id: string, userId: string, corretorId: string | null): Promise<boolean> {
    const linhas = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      update public.parceiro_atribuicoes
         set user_id = ${userId}::uuid, corretor_id = ${corretorId}::uuid,
             status = 'convertida', convertido_em = now()
       where id = ${id}::uuid and status = 'pendente' and user_id is null
      returning id::text as id`);
    return linhas.length > 0;
  }
}
