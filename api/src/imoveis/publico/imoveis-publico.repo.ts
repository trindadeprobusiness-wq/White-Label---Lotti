import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { FiltrosVitrine, LinhaDetalhe, LinhaSimilar, LinhaVitrine } from './imoveis-publico.regras';

/**
 * Leituras públicas como dono do banco (o que as Edge Functions faziam com SERVICE_ROLE): o RLS
 * esconde do anônimo os imóveis não anunciados, então o caminho é o mesmo da fachada pública.
 *
 * SEGURANÇA: ALLOWLIST DE COLUNAS escrita no SQL. public.imoveis tem proprietario_nome/_cpf/
 * _telefone/_email e nada disso pode sair daqui. Nunca troque por select *, to_jsonb(i) ou i.*.
 *
 * jsonb_build_object devolve numeric como número JSON e timestamptz no formato do PostgREST, que é
 * o que a Edge repassava ao site.
 */
const FOTOS = (alias: string) => Prisma.sql`coalesce((
  select jsonb_agg(jsonb_build_object('id', f.id, 'arquivo_url', f.arquivo_url, 'ordem', f.ordem, 'principal', f.principal)
                   order by coalesce(f.ordem, 0), f.created_at, f.id)
    from public.imovel_fotos f where f.imovel_id = ${Prisma.raw(alias)}.id), '[]'::jsonb)`;

@Injectable()
export class ImoveisPublicoRepo {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * public-imoveis. Publicado = fachada ATIVA apontando para o imóvel + imóvel ativo + DISPONIVEL.
   * A finalidade vem de fachadas.tipo_negocio (ALUGUEL e TEMPORADA são locação; o resto é venda) e
   * um imóvel pode ter as duas. O total é contado antes da página, como o count=exact.
   */
  async listarVitrine(f: FiltrosVitrine): Promise<{ total: number; imoveis: LinhaVitrine[] }> {
    const linhas = await this.prisma.$queryRaw<Array<{ total: number; imoveis: LinhaVitrine[] }>>(Prisma.sql`
      with publicaveis as (
        select fa.imovel_id,
               bool_or(upper(coalesce(fa.tipo_negocio, '')) not in ('ALUGUEL', 'TEMPORADA')) as venda,
               bool_or(upper(coalesce(fa.tipo_negocio, '')) in ('ALUGUEL', 'TEMPORADA')) as aluguel
          from public.fachadas fa
         where fa.ativo = true and fa.imovel_id is not null
         group by fa.imovel_id
      ), filtrados as (
        select i.id, i.titulo, i.tipo, i.valor, i.area_m2, i.dormitorios, i.banheiros, i.garagem,
               i.endereco, i.bairro, i.cidade, i.estado, i.descricao, i.descricao_curta, i.created_at,
               p.venda, p.aluguel
          from public.imoveis i
          join publicaveis p on p.imovel_id = i.id
         where i.ativo = true and i.status_venda = 'DISPONIVEL'
           and (${f.tipo}::text is null or (${f.tipo}::text = 'venda' and p.venda) or (${f.tipo}::text = 'aluguel' and p.aluguel))
           and (${f.tipoImovel}::text is null or i.tipo::text = ${f.tipoImovel}::text)
           and (${f.bairro}::text is null or i.bairro ilike '%' || ${f.bairro}::text || '%')
           and (${f.precoMin}::numeric is null or i.valor >= ${f.precoMin}::numeric)
           and (${f.precoMax}::numeric is null or i.valor <= ${f.precoMax}::numeric)
           and (${f.quartosMin}::int is null or i.dormitorios >= ${f.quartosMin}::int)
      ), pagina as (
        select * from filtrados order by created_at desc, id limit ${f.limit}::int offset ${f.offset}::int
      )
      select (select count(*)::int from filtrados) as total,
             coalesce((select jsonb_agg(jsonb_build_object(
                 'id', p.id, 'titulo', p.titulo, 'tipo', p.tipo, 'valor', p.valor, 'area_m2', p.area_m2,
                 'dormitorios', p.dormitorios, 'banheiros', p.banheiros, 'garagem', p.garagem,
                 'endereco', p.endereco, 'bairro', p.bairro, 'cidade', p.cidade, 'estado', p.estado,
                 'descricao', p.descricao, 'descricao_curta', p.descricao_curta, 'created_at', p.created_at,
                 'venda', p.venda, 'aluguel', p.aluguel, 'imovel_fotos', ${FOTOS('p')})
               order by p.created_at desc, p.id) from pagina p), '[]'::jsonb) as imoveis`);
    return { total: Number(linhas[0]?.total ?? 0), imoveis: linhas[0]?.imoveis ?? [] };
  }

  /**
   * imovel-detalhe: o imóvel anunciado (DISPONIVEL, ativo, anunciado) e até 4 similares de qualquer
   * conta com valor entre 70% e 130% do dele — o mesmo filtro da Edge.
   */
  async detalhe(id: string): Promise<{ imovel: LinhaDetalhe; similares: LinhaSimilar[] } | null> {
    const linhas = await this.prisma.$queryRaw<Array<{ imovel: LinhaDetalhe; similares: LinhaSimilar[] }>>(Prisma.sql`
      select jsonb_build_object(
               'id', i.id, 'titulo', i.titulo, 'tipo', i.tipo, 'valor', i.valor, 'area_m2', i.area_m2,
               'dormitorios', i.dormitorios, 'banheiros', i.banheiros, 'garagem', i.garagem,
               'endereco', i.endereco, 'bairro', i.bairro, 'cidade', i.cidade, 'estado', i.estado, 'cep', i.cep,
               'descricao', i.descricao, 'descricao_curta', i.descricao_curta, 'status_venda', i.status_venda,
               'finalidade', i.finalidade, 'created_at', i.created_at, 'imovel_fotos', ${FOTOS('i')}) as imovel,
             coalesce((select jsonb_agg(s.linha order by s.created_at desc, s.id) from (
               select jsonb_build_object(
                        'id', x.id, 'titulo', x.titulo, 'tipo', x.tipo, 'valor', x.valor, 'area_m2', x.area_m2,
                        'dormitorios', x.dormitorios, 'garagem', x.garagem, 'bairro', x.bairro, 'cidade', x.cidade,
                        'estado', x.estado, 'finalidade', x.finalidade, 'imovel_fotos', ${FOTOS('x')}) as linha,
                      x.created_at, x.id
                 from public.imoveis x
                where x.status_venda = 'DISPONIVEL' and x.ativo = true and x.anunciado = true and x.id <> i.id
                  and x.valor >= i.valor * 0.7 and x.valor <= i.valor * 1.3
                order by x.created_at desc, x.id
                limit 4) s), '[]'::jsonb) as similares
        from public.imoveis i
       where i.id = ${id}::uuid and i.status_venda = 'DISPONIVEL' and i.ativo = true and i.anunciado = true`);
    return linhas[0] ?? null;
  }
}
