import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { erroApi, traduzirErroBanco } from '../crm/clientes/crm-clientes.erros';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { AtualizarCorretorDto, COLUNAS_PERFIL_CORRETOR, RegistrarAtividadeDto } from './perfil.dto';

type Linha = Record<string, unknown>;
type Tx = Prisma.TransactionClient;

/**
 * O que o front lia direto do Supabase sobre quem está logado.
 *
 * - `corretor`: a linha de public.corretores do próprio usuário (o `.from('corretores').select('*')
 *   .maybeSingle()` do crmStore; a policy só mostra a linha com user_id = auth.uid()).
 * - `corretor_id`: o resultado de public.get_corretor_id(), a conta EM USO. Não é o id acima para
 *   um membro de equipe (aí é o corretor dono da organização) e é null para conta suspensa. É o
 *   que as telas usavam no `rpc('get_corretor_id')` para montar caminho de arquivo e corretor_id.
 */
export interface PerfilCorretor {
  corretor: Linha | null;
  corretor_id: string | null;
}

@Injectable()
export class PerfilService {
  constructor(private readonly db: TenantDb) {}

  private async executar<T>(claims: SupabaseClaims, trabalho: (tx: Tx) => Promise<T>, semPermissao?: string): Promise<T> {
    try {
      return await this.db.run(claims, trabalho);
    } catch (e) {
      traduzirErroBanco(e, { semPermissao });
    }
  }

  async obter(claims: SupabaseClaims): Promise<PerfilCorretor> {
    const linhas = await this.executar(claims, (tx) => tx.$queryRaw<Array<{ corretor: Linha | null; corretor_id: string | null }>>(Prisma.sql`
      select (select to_jsonb(c) from public.corretores c where c.user_id = ${claims.sub}::uuid limit 1) as corretor,
             public.get_corretor_id()::text as corretor_id`));
    return { corretor: linhas[0]?.corretor ?? null, corretor_id: linhas[0]?.corretor_id ?? null };
  }

  /** Só as colunas da lista; a policy "Corretor atualiza próprio perfil" segue valendo (role authenticated). */
  async atualizar(claims: SupabaseClaims, dto: AtualizarCorretorDto): Promise<Linha> {
    const cols = COLUNAS_PERFIL_CORRETOR.filter((c) => (dto as Record<string, unknown>)[c] !== undefined);
    if (cols.length === 0) throw erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.');
    const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dto as Record<string, unknown>)[c]])));
    const alvo = Prisma.raw(cols.join(', '));
    const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
    return this.executar(
      claims,
      async (tx) => {
        const linhas = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
          update public.corretores t
             set (${alvo}, updated_at) = (select ${origem}, now() from jsonb_populate_record(null::public.corretores, ${json}::jsonb) r)
           where t.user_id = ${claims.sub}::uuid
          returning to_jsonb(t) as linha`);
        if (linhas.length === 0) throw erroApi(404, 'corretor_nao_encontrado', 'Perfil de corretor não encontrado.');
        return linhas[0].linha;
      },
      'Você não tem permissão para alterar este perfil.',
    );
  }

  /** Telemetria de presença (public.registrar_atividade). Função void: vai por $executeRaw. */
  async registrarAtividade(claims: SupabaseClaims, dto: RegistrarAtividadeDto): Promise<void> {
    await this.executar(claims, (tx) => tx.$executeRaw(Prisma.sql`
      select public.registrar_atividade(${dto.tipo}::text, ${dto.rota ?? null}::text)`));
  }
}
