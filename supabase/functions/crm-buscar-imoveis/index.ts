// Edge Function: crm-buscar-imoveis
// Consulta a tabela `imoveis` com filtros enviados pelo n8n/Gemini.
// Auth: header x-n8n-secret

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, assertN8nSecret, json } from '../_shared/auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    assertN8nSecret(req)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const url = new URL(req.url)
    const tipo = url.searchParams.get('tipo')            // VENDA | ALUGUEL
    const categoria = url.searchParams.get('categoria')  // APARTAMENTO | CASA | etc
    const valorMin = Number(url.searchParams.get('valor_min') || 0)
    const valorMax = Number(url.searchParams.get('valor_max') || 0)
    const dormitorios = Number(url.searchParams.get('dormitorios') || 0)
    const cidade = url.searchParams.get('cidade')
    const limit = Math.min(Number(url.searchParams.get('limit') || 5), 20)

    // Resolve o corretor dono da busca. Sem esse filtro, quem tem o
    // N8N_SHARED_SECRET enumera imóveis DISPONIVEL de todos os tenants
    // (roda com service_role, ignora RLS). Mesma proteção que
    // crm-upsert-lead e crm-anexar-historico já aplicam.
    let corretor_id = url.searchParams.get('corretor_id')
    if (corretor_id) {
      const { data: alvo } = await supabase.from('corretores').select('id').eq('id', corretor_id).maybeSingle()
      if (!alvo) return json({ success: false, error: 'corretor_id informado não existe' }, 400)
    } else {
      const { data: corretores } = await supabase.from('corretores').select('id').limit(2)
      if (!corretores?.length) return json({ success: false, error: 'nenhum corretor cadastrado' }, 500)
      if (corretores.length > 1) {
        return json({ success: false, error: 'Há mais de um corretor cadastrado: informe corretor_id na query.' }, 400)
      }
      corretor_id = corretores[0].id
    }

    let query = supabase
      .from('imoveis')
      .select('id, titulo, tipo, categoria, valor, dormitorios, bairro, cidade, url_website, fotos')
      .eq('corretor_id', corretor_id)
      .eq('status', 'DISPONIVEL')
      .limit(limit)

    if (tipo) query = query.eq('tipo', tipo)
    if (categoria) query = query.eq('categoria', categoria)
    if (valorMin > 0) query = query.gte('valor', valorMin)
    if (valorMax > 0) query = query.lte('valor', valorMax)
    if (dormitorios > 0) query = query.gte('dormitorios', dormitorios)
    if (cidade) query = query.ilike('cidade', `%${cidade}%`)

    const { data, error } = await query
    if (error) throw error

    return json({ success: true, total: data?.length ?? 0, imoveis: data })
  } catch (err) {
    // @ts-ignore
    const status = err?.status ?? 400
    return json({ success: false, error: (err as Error).message }, status)
  }
})
