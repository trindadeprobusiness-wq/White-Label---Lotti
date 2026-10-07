// Depois da virada (2026-10-07) o banco de verdade é o Postgres do Railway. As funções que
// recebem chamadas de fora (site, landing pages, Meta Ads, PerfectPay, n8n) continuam com o
// mesmo endereço no Supabase, mas só repassam a requisição para a API, que é quem grava.
// Assim ninguém precisa trocar URL em painel nenhum e nada cai no banco antigo.

const API = (Deno.env.get('LOTTI_API_URL') ?? 'https://api.plataformalotti.com.br').replace(/\/+$/, '');

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-n8n-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Só o que a API usa. Authorization/apikey do Supabase não vão adiante.
const REPASSAR = ['content-type', 'x-n8n-secret', 'user-agent', 'referer', 'origin'];

export function repassarParaRailway(caminho: string) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    const url = new URL(req.url);
    const destino = `${API}${caminho}${url.search}`;
    const headers = new Headers();
    for (const h of REPASSAR) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    // O limite por IP da API precisa do IP do visitante, não do IP do Supabase.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);

    try {
      const resp = await fetch(destino, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
        signal: AbortSignal.timeout(25_000),
      });
      const saida = new Headers(CORS);
      for (const h of ['content-type', 'retry-after', 'cache-control']) {
        const v = resp.headers.get(h);
        if (v) saida.set(h, v);
      }
      return new Response(resp.body, { status: resp.status, headers: saida });
    } catch (e) {
      console.error(JSON.stringify({ codigo: 'repasse_railway_falhou', caminho, erro: String((e as Error)?.name ?? e) }));
      return new Response(JSON.stringify({ error: 'Serviço indisponível no momento. Tente de novo.' }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  };
}
