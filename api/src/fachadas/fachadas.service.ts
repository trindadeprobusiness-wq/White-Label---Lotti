import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { COLUNAS_CRIACAO, COLUNAS_EDICAO, CriarFachadaDto, EditarFachadaDto, LIMITE_LISTA } from './fachadas.dto';
import { ERROS, OpcoesErro, traduzirErroBanco } from './fachadas.erros';

/** Linha de to_jsonb: chaves e tipos iguais aos que o PostgREST entrega hoje. */
export type Linha = Record<string, unknown>;
export type Tx = Prisma.TransactionClient;
export type Linhas = Array<{ linha: Linha }>;

export function presentes<T extends string>(dados: object, permitidas: readonly T[]): T[] {
  return permitidas.filter((c) => (dados as Record<string, unknown>)[c] !== undefined);
}

/** Colunas vêm só das constantes do DTO; os valores vão num JSON convertido pelo próprio banco. */
export function montarCampos(dados: object, cols: readonly string[]) {
  const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dados as Record<string, unknown>)[c]])));
  const alvo = Prisma.raw(cols.join(', '));
  const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
  return { json, alvo, origem };
}

export async function corretorDoUsuario(tx: Tx): Promise<string> {
  const linhas = await tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`select public.get_corretor_id()::text as id`);
  const id = linhas[0]?.id;
  if (!id) throw ERROS.corretorNaoIdentificado();
  return id;
}

/**
 * O imóvel da placa tem de ser visível para quem cria (RLS de public.imoveis: os do próprio corretor
 * mais os da organização). O RLS de INSERT em public.fachadas confere só o corretor_id, e a rota
 * pública P1 lê como dono do banco — sem esta trava, A publicaria o imóvel de B na landing dela.
 */
export async function exigirImovelVisivel(tx: Tx, imovelId: string): Promise<void> {
  const linhas = await tx.$queryRaw<Array<{ ok: boolean }>>(Prisma.sql`
    select true as ok from public.imoveis where id = ${imovelId}::uuid limit 1`);
  if (linhas.length === 0) throw ERROS.imovelIndisponivel();
}

/** Principal, senão a primeira por ordem; o desempate por id evita galeria embaralhada (contrato §6.6). */
export const SQL_FOTO_PRINCIPAL = (imovelId: string): Prisma.Sql => Prisma.sql`
  select arquivo_url from public.imovel_fotos
   where imovel_id = ${imovelId}::uuid
   order by principal desc, ordem asc nulls last, id
   limit 1`;

/** Erro do banco é traduzido FORA do run: dentro dele a transação já está abortada. */
export async function rodar<T>(db: TenantDb, claims: SupabaseClaims, trabalho: (tx: Tx) => Promise<T>, op: OpcoesErro = {}): Promise<T> {
  try {
    return await db.run(claims, trabalho);
  } catch (e) {
    traduzirErroBanco(e, op);
  }
}

@Injectable()
export class FachadasService {
  constructor(private readonly db: TenantDb) {}

  /** F1: to_jsonb + embeds no formato do PostgREST. Nenhum filtro por corretor: quem decide é o RLS. */
  async listar(claims: SupabaseClaims): Promise<Linha[]> {
    const linhas = await rodar(this.db, claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(f)
        || jsonb_build_object(
             'imovel', (select jsonb_build_object('titulo', i.titulo, 'tipo', i.tipo, 'valor', i.valor,
                                'area_m2', i.area_m2, 'dormitorios', i.dormitorios, 'garagem', i.garagem,
                                'endereco', i.endereco, 'bairro', i.bairro, 'cidade', i.cidade,
                                'descricao', i.descricao)
                         from public.imoveis i where i.id = f.imovel_id),
             'corretor', (select jsonb_build_object('nome', c.nome, 'telefone', c.telefone, 'email', c.email,
                                  'creci', c.creci, 'foto_url', c.foto_url, 'razao_social', c.razao_social)
                           from public.corretores c where c.id = f.corretor_id)
           ) as linha
        from public.fachadas f
       order by f.created_at desc, f.id
       limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  /** F2: o id vem do gen_random_uuid() do banco — a API nunca manda id (abertura do contrato, ponto 1). */
  criar(claims: SupabaseClaims, dto: CriarFachadaDto): Promise<Linha> {
    return rodar(this.db, claims, async (tx) => {
      const corretor = await corretorDoUsuario(tx);
      await exigirImovelVisivel(tx, dto.imovel_id);
      let foto = dto.foto_principal_url ?? null;
      if (foto === null) {
        const fotos = await tx.$queryRaw<Array<{ arquivo_url: string }>>(SQL_FOTO_PRINCIPAL(dto.imovel_id));
        foto = fotos[0]?.arquivo_url ?? null;
      }
      const { json, alvo, origem } = montarCampos(dto, presentes(dto, COLUNAS_CRIACAO));
      const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
        insert into public.fachadas as x (corretor_id, foto_principal_url, ${alvo})
        select ${corretor}::uuid, ${foto}::text, ${origem}
          from jsonb_populate_record(null::public.fachadas, ${json}::jsonb) r
        returning to_jsonb(x) as linha`);
      return linhas[0].linha;
    });
  }

  /** F3: sem linha → 404 (é o que o RLS dá para fachada de outro corretor: update que não casa, não erro). */
  // async de propósito: o 400 de corpo vazio sai pela promessa, não por um throw sincrono.
  async editar(claims: SupabaseClaims, id: string, dto: EditarFachadaDto): Promise<Linha> {
    const cols = presentes(dto, COLUNAS_EDICAO);
    if (cols.length === 0) throw ERROS.nadaParaAtualizar();
    const { json, alvo, origem } = montarCampos(dto, cols);
    return rodar(this.db, claims, async (tx) => {
      const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
        update public.fachadas t
           set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.fachadas, ${json}::jsonb) r)
         where t.id = ${id}::uuid
        returning to_jsonb(t) as linha`);
      if (linhas.length === 0) throw ERROS.naoEncontrado();
      return linhas[0].linha;
    });
  }

  /** F4: apaga (o botão do front diz "desativar", mas o comportamento de hoje é apagar — §7.1.7). */
  async remover(claims: SupabaseClaims, id: string): Promise<void> {
    await rodar(this.db, claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        delete from public.fachadas where id = ${id}::uuid returning id::text as id`);
      if (linhas.length === 0) throw ERROS.naoEncontrado();
    });
  }
}
