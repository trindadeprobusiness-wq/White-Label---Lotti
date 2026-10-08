import { PublicRequestError, readPublicJson, UUID_PATTERN } from '../_shared/public-request.ts';
import { record, rpc, type RpcClient } from '../diagnostic/contracts.ts';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
function filter(value: unknown) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 200) throw new PublicRequestError(400, 'Filtro inválido.');
  return value.trim() || null;
}

/** Railway verifies the actual login and current admin roles; JWT claims alone never authorize. */
export function createDiagnosticAdminHandler(deps: { client: RpcClient; authApiUrl: string; fetch?: typeof fetch }) {
  return async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') return reply({ error: 'Método inválido.' }, 405);
    const token = request.headers.get('authorization') || '';
    if (!/^Bearer [^\s]{32,8000}$/.test(token)) return reply({ error: 'Entre novamente na Lotti.' }, 401);
    try {
      const authUrl = new URL('/api/admin/papeis', deps.authApiUrl);
      if (authUrl.protocol !== 'https:') throw new Error('auth_configuration');
      const auth = await (deps.fetch || fetch)(authUrl, { headers: { Authorization: token }, signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (auth.status === 401 || auth.status === 403) return reply({ error: 'Sessão inválida ou sem acesso administrativo.' }, auth.status);
      if (!auth.ok) throw new Error('auth_unavailable');
      const roles = await auth.json();
      if (!Array.isArray(roles) || !roles.some(role => role === 'admin' || role === 'super_admin')) return reply({ error: 'Acesso administrativo necessário.' }, 403);
      const body = record(await readPublicJson(request, 16_384));
      if (body.action === 'list') {
        const filters = body.filters == null ? {} : record(body.filters);
        const page = filters.page ?? 1;
        if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 || page > 100000) throw new PublicRequestError(400, 'Página inválida.');
        return reply(await rpc(deps.client, 'diagnostic_admin_list', { _search: filter(filters.search), _status: filter(filters.status), _temperature: filter(filters.temperature), _segment: filter(filters.segment), _source: filter(filters.source), _offset: (page - 1) * 25, _limit: 25 }));
      }
      if (typeof body.session_id !== 'string' || !UUID_PATTERN.test(body.session_id)) throw new PublicRequestError(400, 'Diagnóstico inválido.');
      if (body.action === 'detail') {
        const detail = await rpc(deps.client, 'diagnostic_admin_detail', { p_session: body.session_id });
        return detail ? reply(detail) : reply({ error: 'Diagnóstico não encontrado.' }, 404);
      }
      if (body.action === 'follow_up') {
        if (typeof body.status !== 'string' || !['new','contacted','meeting','won','lost'].includes(body.status) || typeof body.notes !== 'string' || body.notes.length > 3000) throw new PublicRequestError(400, 'Acompanhamento inválido.');
        return reply(await rpc(deps.client, 'diagnostic_admin_follow_up', { p_session: body.session_id, p_status: body.status, p_notes: body.notes }));
      }
      throw new PublicRequestError(400, 'Ação inválida.');
    } catch (error) {
      return reply({ error: error instanceof PublicRequestError ? error.message : 'Não foi possível acessar os diagnósticos. Tente novamente.' }, error instanceof PublicRequestError ? error.status : 503);
    }
  };
}
