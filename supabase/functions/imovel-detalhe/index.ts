import { PublicRequestError, UUID_PATTERN } from '../_shared/public-request.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

/**
 * Edge Function: imovel-detalhe
 * 
 * Retorna um imóvel completo com todas as fotos + imóveis similares.
 * Apenas imóveis anunciados publicamente (anunciado=true).
 * 
 * Query params:
 *   - id: UUID do imóvel (obrigatório)
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (!['GET'].includes(req.method)) return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id || !UUID_PATTERN.test(id)) {
      return new Response(
        JSON.stringify({ error: 'Parâmetro "id" é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Buscar imóvel principal com fotos
    const { data: imovel, error } = await supabase
      .from('imoveis')
      .select(`
        id, titulo, tipo, valor, area_m2, dormitorios, banheiros, garagem,
        endereco, bairro, cidade, estado, cep, descricao, descricao_curta,
        status_venda, finalidade, created_at,
        imovel_fotos ( id, arquivo_url, ordem, principal )
      `)
      .eq('id', id)
      .eq('status_venda', 'DISPONIVEL')
      .eq('ativo', true)
      .eq('anunciado', true)
      .single()

    if (error || !imovel) {
      return new Response(
        JSON.stringify({ error: 'Imóvel não encontrado ou não disponível' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Organizar fotos
    const fotos = ((imovel as any).imovel_fotos || [])
      .sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0))
    const fotoPrincipal = fotos.find((f: any) => f.principal) || fotos[0]

    // 2. Buscar imóveis similares (mesmo bairro ou tipo, faixa de preço ±30%)
    const valor = Number(imovel.valor)
    const precoMin = valor * 0.7
    const precoMax = valor * 1.3

    const { data: similares } = await supabase
      .from('imoveis')
      .select(`
        id, titulo, tipo, valor, area_m2, dormitorios, garagem,
        bairro, cidade, estado, finalidade,
        imovel_fotos ( arquivo_url, ordem, principal )
      `)
      .eq('status_venda', 'DISPONIVEL')
      .eq('ativo', true)
      .eq('anunciado', true)
      .neq('id', id)
      .gte('valor', precoMin)
      .lte('valor', precoMax)
      .limit(4)

    // Normalizar similares
    const imoveisSimilares = (similares || []).map((s: any) => {
      const sFotos = (s.imovel_fotos || [])
        .sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0))
      const sFotoPrincipal = sFotos.find((f: any) => f.principal) || sFotos[0]
      return {
        id: s.id,
        titulo: s.titulo,
        tipo_imovel: s.tipo,
        tipo_negocio: s.finalidade === 'LOCACAO' ? 'aluguel' : 'venda',
        valor: Number(s.valor),
        area_m2: Number(s.area_m2) || 0,
        dormitorios: s.dormitorios || 0,
        garagem: s.garagem || 0,
        bairro: s.bairro,
        cidade: s.cidade,
        foto_principal: sFotoPrincipal?.arquivo_url || null,
      }
    })

    return new Response(
      JSON.stringify({
        data: {
          id: imovel.id,
          titulo: imovel.titulo,
          tipo_imovel: imovel.tipo,
          tipo_negocio: (imovel as any).finalidade === 'LOCACAO' ? 'aluguel' : 'venda',
          valor: Number(imovel.valor),
          area_m2: Number(imovel.area_m2) || 0,
          dormitorios: imovel.dormitorios || 0,
          banheiros: (imovel as any).banheiros || 0,
          garagem: imovel.garagem || 0,
          endereco: imovel.endereco,
          bairro: imovel.bairro,
          cidade: imovel.cidade,
          estado: imovel.estado,
          cep: imovel.cep,
          descricao: imovel.descricao,
          descricao_curta: (imovel as any).descricao_curta || (imovel.descricao?.substring(0, 120) + '...'),
          foto_principal: fotoPrincipal?.arquivo_url || null,
          fotos: fotos.map((f: any) => f.arquivo_url),
          created_at: imovel.created_at,
        },
        similares: imoveisSimilares,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    const status = error instanceof PublicRequestError ? error.status : 500
    const errorMessage = error instanceof PublicRequestError ? error.message : 'Não foi possível carregar os dados. Tente novamente.'
    return new Response(JSON.stringify({ error: errorMessage }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
