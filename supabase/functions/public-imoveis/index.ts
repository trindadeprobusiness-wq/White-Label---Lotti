import { PublicRequestError, publicInteger } from '../_shared/public-request.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

/**
 * Edge Function: public-imoveis
 *
 * Endpoint público (sem auth) que alimenta o site institucional.
 *
 * REGRA DE PUBLICAÇÃO — um imóvel só aparece no site se, e somente se:
 *   1. existir uma Fachada Inteligente ATIVA apontando para ele (fachadas.ativo = true), E
 *   2. o imóvel estiver ativo (imoveis.ativo = true), E
 *   3. o imóvel estiver disponível (imoveis.status_venda = 'DISPONIVEL').
 *
 * A Fachada Inteligente é o ÚNICO gatilho de publicação. Criar a fachada no CRM
 * publica no site; desativá-la despublica. Nenhum outro dado do CRM é exposto.
 *
 * A finalidade (venda x locação) vem de fachadas.tipo_negocio — NÃO de imoveis.finalidade —
 * porque é na fachada que o corretor declara como aquele imóvel está sendo anunciado.
 *
 * SEGURANÇA: o SELECT em `imoveis` usa allowlist explícita de colunas. A tabela contém
 * proprietario_nome / proprietario_cpf / proprietario_telefone / proprietario_email —
 * esses campos NUNCA podem sair por este endpoint. Nunca troque por select('*').
 *
 * Query params:
 *   - tipo: "venda" | "aluguel" (filtra por finalidade da fachada)
 *   - limit: número (max 20, default 12)
 *   - offset: número (paginação, default 0)
 *   - bairro: string (filtro ilike)
 *   - preco_min / preco_max: número
 *   - quartos_min: número
 *   - tipo_imovel: "APARTAMENTO" | "CASA" | "COMERCIAL" | "TERRENO"
 */

// Colunas públicas de `imoveis`. Allowlist — ver nota de segurança acima.
const COLUNAS_PUBLICAS = `
  id, titulo, tipo, valor, area_m2, dormitorios, banheiros, garagem,
  endereco, bairro, cidade, estado, descricao, descricao_curta, created_at,
  imovel_fotos ( id, arquivo_url, ordem, principal )
`

/** Mapeia o tipo_negocio da fachada para a finalidade que o site entende. */
function finalidadeDoSite(tipoNegocioFachada: string): 'venda' | 'aluguel' {
  const t = (tipoNegocioFachada || '').toUpperCase()
  // ALUGUEL e TEMPORADA são locação; VENDA e LANCAMENTO são venda.
  return t === 'ALUGUEL' || t === 'TEMPORADA' ? 'aluguel' : 'venda'
}

/** Gera a descrição curta sem produzir a string "undefined..." quando não há descrição. */
function descricaoCurta(curta: string | null, longa: string | null): string {
  if (curta) return curta
  if (!longa) return ''
  return longa.length > 120 ? `${longa.substring(0, 120)}...` : longa
}

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
    const tipo = url.searchParams.get('tipo')?.toLowerCase() // "venda" | "aluguel"
    const limit = publicInteger(url.searchParams.get('limit'), 12, 1, 20)
    const offset = publicInteger(url.searchParams.get('offset'), 0, 0, 10000)
    const bairro = url.searchParams.get('bairro')
    const precoMin = url.searchParams.get('preco_min')
    const precoMax = url.searchParams.get('preco_max')
    const quartosMin = url.searchParams.get('quartos_min')
    const tipoImovel = url.searchParams.get('tipo_imovel')

    if (bairro && bairro.length > 120) throw new PublicRequestError(400, 'Bairro inválido.')
    for (const value of [precoMin, precoMax, quartosMin]) {
      if (value !== null && (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e12)) throw new PublicRequestError(400, 'Filtro inválido.')
    }
    if (quartosMin !== null && !Number.isInteger(Number(quartosMin))) throw new PublicRequestError(400, 'Filtro inválido.')
    if (precoMin !== null && precoMax !== null && Number(precoMin) > Number(precoMax)) throw new PublicRequestError(400, 'Faixa de preço inválida.')

    const vazio = (extra: Record<string, unknown> = {}) =>
      new Response(JSON.stringify({ data: [], total: 0, limit, offset, ...extra }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })

    // ── 1. Fachadas ativas: a fonte da verdade sobre o que está publicado ──
    const { data: fachadas, error: erroFachadas } = await supabase
      .from('fachadas')
      .select('imovel_id, tipo_negocio')
      .eq('ativo', true)

    if (erroFachadas) {
      return new Response(JSON.stringify({ error: 'Não foi possível carregar os dados.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!fachadas || fachadas.length === 0) return vazio()

    // Um imóvel pode ter mais de uma fachada (ex.: anunciado para venda E locação).
    // Guardamos todas as finalidades declaradas por imóvel.
    const finalidadesPorImovel = new Map<string, Set<'venda' | 'aluguel'>>()
    for (const f of fachadas) {
      if (!f.imovel_id) continue
      const set = finalidadesPorImovel.get(f.imovel_id) ?? new Set()
      set.add(finalidadeDoSite(f.tipo_negocio))
      finalidadesPorImovel.set(f.imovel_id, set)
    }

    // Se o site pediu uma finalidade específica, reduzimos a lista antes de ir ao banco.
    const idsPublicaveis = [...finalidadesPorImovel.entries()]
      .filter(([, finalidades]) =>
        tipo === 'venda' || tipo === 'aluguel' ? finalidades.has(tipo) : true
      )
      .map(([imovelId]) => imovelId)

    if (idsPublicaveis.length === 0) return vazio()

    // ── 2. Dados dos imóveis publicáveis (allowlist de colunas) ──
    let query = supabase
      .from('imoveis')
      .select(COLUNAS_PUBLICAS, { count: 'exact' })
      .in('id', idsPublicaveis)
      .eq('ativo', true)
      .eq('status_venda', 'DISPONIVEL')

    if (tipoImovel) query = query.eq('tipo', tipoImovel.toUpperCase())
    if (bairro) query = query.ilike('bairro', `%${bairro}%`)
    if (precoMin) query = query.gte('valor', Number(precoMin))
    if (precoMax) query = query.lte('valor', Number(precoMax))
    if (quartosMin) query = query.gte('dormitorios', Number(quartosMin))

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      return new Response(JSON.stringify({ error: 'Não foi possível carregar os dados.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 3. Normalização para o contrato que o site consome ──
    const imoveis = (data || []).map((imovel: any) => {
      const fotos = (imovel.imovel_fotos || [])
        .slice()
        .sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0))

      const fotoPrincipal = fotos.find((f: any) => f.principal) || fotos[0]

      // A finalidade sai da fachada. Quando o imóvel tem fachadas de venda e de
      // locação, devolvemos a que o site pediu.
      const finalidades = finalidadesPorImovel.get(imovel.id)
      const tipoNegocio =
        tipo === 'venda' || tipo === 'aluguel'
          ? tipo
          : finalidades?.has('venda')
            ? 'venda'
            : 'aluguel'

      return {
        id: imovel.id,
        titulo: imovel.titulo,
        tipo_imovel: imovel.tipo,
        tipo_negocio: tipoNegocio,
        valor: Number(imovel.valor),
        area_m2: Number(imovel.area_m2) || 0,
        dormitorios: imovel.dormitorios || 0,
        banheiros: imovel.banheiros || 0,
        garagem: imovel.garagem || 0,
        endereco: imovel.endereco,
        bairro: imovel.bairro,
        cidade: imovel.cidade,
        estado: imovel.estado,
        descricao: imovel.descricao,
        descricao_curta: descricaoCurta(imovel.descricao_curta, imovel.descricao),
        foto_principal: fotoPrincipal?.arquivo_url || null,
        fotos: fotos.map((f: any) => f.arquivo_url),
        created_at: imovel.created_at,
      }
    })

    return new Response(
      JSON.stringify({
        data: imoveis,
        total: count || 0,
        limit,
        offset,
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
