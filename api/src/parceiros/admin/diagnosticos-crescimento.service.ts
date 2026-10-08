import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErroPublico, registro, resposta, type RespostaPublica, UUID } from '../../diagnostico-crescimento/contratos';
import { type SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import { erroPg } from '../parceiros.erros';

type Tx = Prisma.TransactionClient;

const ETAPAS = ['new', 'contacted', 'meeting', 'won', 'lost'];
const POR_PAGINA = 25;
const SEM_ACESSO = 'Acesso administrativo necessário.';
const INDISPONIVEL = 'Não foi possível acessar os diagnósticos. Tente novamente.';

/** filter() da Edge: vazio vira null; texto com mais de 200 caracteres ou de outro tipo é 400. */
function filtro(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > 200) throw new ErroPublico(400, 'Filtro inválido.');
  return v.trim() || null;
}

async function resultado(tx: Tx, consulta: Prisma.Sql): Promise<unknown> {
  const linhas = await tx.$queryRaw<Array<{ resultado: unknown }>>(consulta);
  return linhas[0]?.resultado ?? null;
}

/**
 * Porte da Edge Function `diagnostic-admin` (#54, supabase/functions/diagnostic-admin/handler.ts):
 * POST com `{ action: 'list' | 'detail' | 'follow_up', ... }`, mesmas validações, mesmas RPCs
 * (diagnostic_admin_list, diagnostic_admin_detail, diagnostic_admin_follow_up) e o mesmo corpo de
 * saída: o jsonb da RPC no sucesso e `{ error }` no erro.
 *
 * Na Edge o papel vinha de /api/admin/papeis e a RPC rodava como service_role. Aqui a rota já tem o
 * SupabaseAuthGuard e tudo roda no TenantDb como `authenticated`: o is_admin() de antes dá o 403 sem
 * ler o corpo (como a Edge, que conferia o papel primeiro) e as RPCs conferem is_admin() de novo. O
 * atalho `role = service_role` das funções não vale aqui: o TenantDb só aceita claims authenticated.
 */
@Injectable()
export class DiagnosticosCrescimentoAdminService {
  constructor(private readonly db: TenantDb) {}

  async executar(claims: SupabaseClaims, corpo: unknown): Promise<RespostaPublica> {
    try {
      return await this.db.run(claims, async (tx) => {
        const admin = await tx.$queryRaw<Array<{ ok: boolean }>>(Prisma.sql`select public.is_admin() as ok`);
        if (admin[0]?.ok !== true) return resposta({ error: SEM_ACESSO }, 403);
        return this.acao(tx, registro(corpo));
      });
    } catch (e) {
      if (e instanceof ErroPublico) return resposta({ error: e.message }, e.status);
      if (erroPg(e)?.sqlstate === '42501') return resposta({ error: SEM_ACESSO }, 403);
      // Como a Edge: qualquer outro erro do banco é 503 genérico, sem o texto do Postgres.
      return resposta({ error: INDISPONIVEL }, 503);
    }
  }

  private async acao(tx: Tx, entrada: Record<string, unknown>): Promise<RespostaPublica> {
    if (entrada.action === 'list') {
      const filtros = entrada.filters == null ? {} : registro(entrada.filters);
      const pagina = filtros.page ?? 1;
      if (typeof pagina !== 'number' || !Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) {
        throw new ErroPublico(400, 'Página inválida.');
      }
      return resposta(await resultado(tx, Prisma.sql`select public.diagnostic_admin_list(
        _search => ${filtro(filtros.search)}::text, _status => ${filtro(filtros.status)}::text,
        _temperature => ${filtro(filtros.temperature)}::text, _segment => ${filtro(filtros.segment)}::text,
        _source => ${filtro(filtros.source)}::text, _offset => ${(pagina - 1) * POR_PAGINA}::int,
        _limit => ${POR_PAGINA}::int) as resultado`));
    }
    if (typeof entrada.session_id !== 'string' || !UUID.test(entrada.session_id)) throw new ErroPublico(400, 'Diagnóstico inválido.');
    const sessao = entrada.session_id;
    if (entrada.action === 'detail') {
      const detalhe = await resultado(tx, Prisma.sql`select public.diagnostic_admin_detail(p_session => ${sessao}::uuid) as resultado`);
      return detalhe ? resposta(detalhe) : resposta({ error: 'Diagnóstico não encontrado.' }, 404);
    }
    if (entrada.action === 'follow_up') {
      if (typeof entrada.status !== 'string' || !ETAPAS.includes(entrada.status) || typeof entrada.notes !== 'string' || entrada.notes.length > 3000) {
        throw new ErroPublico(400, 'Acompanhamento inválido.');
      }
      return resposta(await resultado(tx, Prisma.sql`select public.diagnostic_admin_follow_up(
        p_session => ${sessao}::uuid, p_status => ${entrada.status}::text, p_notes => ${entrada.notes}::text) as resultado`));
    }
    throw new ErroPublico(400, 'Ação inválida.');
  }
}
