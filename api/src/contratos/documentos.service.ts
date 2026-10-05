import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { LIMITE_LISTA } from './contratos.dto';
import { erroApi, OpcoesErro, traduzirErroBanco } from './contratos.erros';
import { corretorDoUsuario, exigirVinculos, Linha, montarCampos, presentes, Tx } from './contratos.service';
import { AlterarDocumentoDto, COLUNAS_DOC_ALTERACAO, COLUNAS_DOC_CRIACAO, CriarDocumentoDto } from './documentos.dto';

type Linhas = Array<{ linha: Linha }>;

const OPCOES: OpcoesErro = { semPermissao: 'Você não tem permissão para gerenciar documentos desta conta.' };
const naoEncontrado = () => erroApi(404, 'documento_nao_encontrado', 'Documento não encontrado.');

/** documentos não tem updated_at: a API nunca escreve essa coluna. */
@Injectable()
export class DocumentosService {
  constructor(private readonly db: TenantDb) {}

  private async rodar<T>(claims: SupabaseClaims, trabalho: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.run(claims, trabalho);
    } catch (e) {
      traduzirErroBanco(e, OPCOES);
    }
  }

  async listar(claims: SupabaseClaims): Promise<Linha[]> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(d) as linha from public.documentos d order by d.created_at desc, d.id limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  criar(claims: SupabaseClaims, dto: CriarDocumentoDto): Promise<Linha> {
    return this.rodar(claims, async (tx) => {
      const corretor = await corretorDoUsuario(tx);
      if (!dto.arquivo_path.startsWith(`${corretor}/`)) throw erroApi(422, 'arquivo_invalido', 'O arquivo não pertence a esta conta.');
      await exigirVinculos(tx, dto);
      const { json, alvo, origem } = montarCampos(dto, presentes(dto, COLUNAS_DOC_CRIACAO));
      const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
        insert into public.documentos as x (corretor_id, validado, ${alvo})
        select ${corretor}::uuid, false, ${origem} from jsonb_populate_record(null::public.documentos, ${json}::jsonb) r
        returning to_jsonb(x) as linha`);
      return linhas[0].linha;
    });
  }

  alterar(claims: SupabaseClaims, id: string, dto: AlterarDocumentoDto): Promise<Linha> {
    const cols = presentes(dto, COLUNAS_DOC_ALTERACAO);
    if (cols.length === 0) throw erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.');
    const { json, alvo, origem } = montarCampos(dto, cols);
    return this.rodar(claims, async (tx) => {
      await exigirVinculos(tx, dto);
      const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
        update public.documentos t set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.documentos, ${json}::jsonb) r)
        where t.id = ${id}::uuid returning to_jsonb(t) as linha`);
      if (linhas.length === 0) throw naoEncontrado();
      return linhas[0].linha;
    });
  }

  remover(claims: SupabaseClaims, id: string): Promise<void> {
    return this.rodar(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        delete from public.documentos where id = ${id}::uuid returning id::text as id`);
      if (linhas.length === 0) throw naoEncontrado();
    });
  }
}
