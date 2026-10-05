import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Linha } from '../fachadas.service';
import { EnviarLeadDto } from './fachadas-publico.dto';

export interface FachadaPublica {
  fachada: Linha;
  fotos: Linha[];
}

/**
 * Caminho público (contrato §0.2.2). Duas formas, e a escolha de cada uma é deliberada:
 *
 * - LEITURA (P1) como dono do banco, sem troca de role: é o porte fiel da Edge Function, que usa
 *   SERVICE_ROLE porque o RLS esconde do anônimo os imóveis não anunciados e a tabela corretores inteira.
 *   A proteção aqui é a ALLOWLIST DE COLUNAS escrita no SQL mais o filtro ativo = true. Nenhum select *,
 *   nenhum to_jsonb(f): coluna nova em public.fachadas não aparece sozinha nesta resposta.
 * - ESCRITA (P2, P3) dentro de uma transação com `set local role anon`: reproduz o comportamento de hoje
 *   linha por linha — as policies WITH CHECK public_fachada_active, o gatilho guard_public_fachada_insert
 *   (que só força convertido/cliente_id/created_at/ip_hash quando current_setting('role') é 'anon') e os
 *   limites de consume_public_request_limit continuam valendo. Rodando como dono do banco, essa trava sairia.
 */
@Injectable()
export class FachadasPublicoRepo {
  constructor(private readonly prisma: PrismaService) {}

  /** A ÚNICA ocorrência de $executeRawUnsafe do módulo: `set local role` não aceita parâmetro. */
  private async comoAnonimo<T>(trabalho: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'anon' })}, true)`;
      await tx.$executeRawUnsafe('set local role anon'); // string constante; nenhum valor do cliente entra aqui
      return trabalho(tx);
    });
  }

  /** P1. Allowlist idêntica à da Edge Function fachada-publica: 12 colunas, 14 do imóvel, 6 do corretor, 3 por foto. */
  async verFachada(id: string): Promise<FachadaPublica | null> {
    const linhas = await this.prisma.$queryRaw<FachadaPublica[]>(Prisma.sql`
      select jsonb_build_object(
          'id', f.id, 'corretor_id', f.corretor_id, 'imovel_id', f.imovel_id,
          'tipo_negocio', f.tipo_negocio, 'template_id', f.template_id, 'cta_principal', f.cta_principal,
          'modo_conversao', f.modo_conversao, 'mensagem_whatsapp', f.mensagem_whatsapp,
          'logo_url', f.logo_url, 'foto_principal_url', f.foto_principal_url,
          'ativo', f.ativo, 'created_at', f.created_at,
          'imovel', (select jsonb_build_object('id', i.id, 'titulo', i.titulo, 'tipo', i.tipo,
                       'valor', i.valor, 'area_m2', i.area_m2, 'dormitorios', i.dormitorios,
                       'banheiros', i.banheiros, 'garagem', i.garagem, 'endereco', i.endereco,
                       'bairro', i.bairro, 'cidade', i.cidade, 'estado', i.estado, 'descricao', i.descricao)
                      from public.imoveis i where i.id = f.imovel_id),
          'corretor', (select jsonb_build_object('nome', c.nome, 'telefone', c.telefone, 'email', c.email,
                         'creci', c.creci, 'foto_url', c.foto_url, 'razao_social', c.razao_social)
                        from public.corretores c where c.id = f.corretor_id)
        ) as fachada,
        coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'arquivo_url', p.arquivo_url,
                    'principal', p.principal) order by p.ordem asc nulls last, p.id)
                   from public.imovel_fotos p where p.imovel_id = f.imovel_id), '[]'::jsonb) as fotos
      from public.fachadas f
      where f.id = ${id}::uuid and f.ativo = true`);
    return linhas[0] ?? null;
  }

  /**
   * P2. Sem RETURNING: anon tem INSERT em fachada_escaneamentos, mas a policy de SELECT é a do corretor
   * e um RETURNING daria 42501 — é por isso que hoje o front também insere sem .select().
   */
  async registrarEscaneamento(id: string, userAgent: string | null): Promise<void> {
    await this.comoAnonimo((tx) => tx.$executeRaw(Prisma.sql`
      insert into public.fachada_escaneamentos (fachada_id, user_agent)
      values (${id}::uuid, ${userAgent}::text)`));
  }

  /**
   * P3. Quatro colunas, e só essas: convertido, cliente_id e created_at ficam com o default, e o gatilho
   * os reforça porque o role é anon. O telefone gravado é o que o visitante digitou (contrato §2.3).
   */
  async criarLead(id: string, dto: EnviarLeadDto): Promise<void> {
    const email = dto.email ?? null;
    await this.comoAnonimo((tx) => tx.$executeRaw(Prisma.sql`
      insert into public.fachada_leads (fachada_id, nome, telefone, email)
      values (${id}::uuid, ${dto.nome}::text, ${dto.telefone}::text, ${email}::text)`));
  }
}
