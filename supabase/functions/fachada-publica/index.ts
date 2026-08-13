import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

/**
 * Edge Function: fachada-publica
 *
 * Serve os dados da landing page pública de uma fachada (o destino do QR Code).
 *
 * POR QUE existe: a página pública roda como `anon`, e o RLS (corretamente) esconde
 * do anônimo os imóveis não-anunciados e a tabela `corretores` inteira. Resultado:
 * a landing abria VAZIA (sem imóvel, sem foto, sem contato). Esta função usa
 * SERVICE_ROLE — como public-imoveis e imovel-detalhe — e devolve APENAS campos
 * seguros: dados do imóvel do anúncio + o contato COMERCIAL do corretor. Nenhum
 * dado de PII do proprietário (proprietario_cpf/nome/telefone/email) é retornado.
 *
 * Params: ?id=<fachadaId>  (ou body JSON { fachadaId })
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const url = new URL(req.url)
    let fachadaId = url.searchParams.get('id') ?? url.searchParams.get('fachadaId')
    if (!fachadaId && req.method === 'POST') {
      try {
        const body = await req.json()
        fachadaId = body?.fachadaId ?? body?.id ?? null
      } catch { /* sem body */ }
    }

    if (!fachadaId) {
      return json({ error: 'Parâmetro "id" (fachadaId) é obrigatório' }, 400)
    }

    // 1. Fachada (apenas ativa) + imóvel (campos seguros) + corretor (contato comercial).
    // Allowlist explícita: um `select('*')` faz qualquer coluna nova da tabela
    // `fachadas` (ex. notas internas, custos, tokens) vazar automaticamente
    // por este endpoint anônimo que roda com service_role.
    const { data: fachada, error } = await supabase
      .from('fachadas')
      .select(`
        id, corretor_id, imovel_id, tipo_negocio, template_id, cta_principal,
        modo_conversao, mensagem_whatsapp, logo_url, foto_principal_url,
        ativo, created_at,
        imovel:imoveis (
          id, titulo, tipo, valor, area_m2, dormitorios, banheiros, garagem,
          endereco, bairro, cidade, estado, descricao
        ),
        corretor:corretores (
          nome, telefone, email, creci, foto_url, razao_social
        )
      `)
      .eq('id', fachadaId)
      .eq('ativo', true)
      .single()

    if (error || !fachada) {
      return json({ error: 'Fachada não encontrada ou inativa' }, 404)
    }

    // 2. Fotos do imóvel (ordenadas)
    let fotos: { id: string; arquivo_url: string; principal: boolean }[] = []
    if ((fachada as any).imovel_id) {
      const { data: fotosData } = await supabase
        .from('imovel_fotos')
        .select('id, arquivo_url, principal, ordem')
        .eq('imovel_id', (fachada as any).imovel_id)
        .order('ordem', { ascending: true })

      fotos = (fotosData || []).map((f: any) => ({
        id: f.id,
        arquivo_url: f.arquivo_url,
        principal: !!f.principal,
      }))
    }

    return json({
      fachada: {
        ...fachada,
        imovel: (fachada as any).imovel ?? null,
        corretor: (fachada as any).corretor ?? null,
      },
      fotos,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return json({ error: errorMessage }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
