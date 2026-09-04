import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  slugValido,
  uuidValido,
  hashIp,
  ipDoRequest,
  limparUtm,
  truncar,
} from '../_shared/parceiro.ts'

/**
 * Edge Function: parceiro-clique
 *
 * Registra, NO SERVIDOR, que um visitante chegou pelo link de um parceiro.
 *
 * POR QUE existe: a atribuição não pode depender de nada que o cliente informe.
 * Se o front dissesse "sou do parceiro X", qualquer pessoa reivindicaria a
 * comissão de qualquer parceiro editando um valor no localStorage. Aqui o
 * servidor resolve o slug, confere se o link está ativo e grava o vínculo na
 * própria base. Na conversão (parceiro-atribuir) ele relê o que ele mesmo
 * escreveu — o cliente nunca informa o parceiro, só um identificador opaco.
 *
 * A regra de PRIMEIRO CLIQUE não é implementada aqui: é o UNIQUE(visitante_id)
 * em parceiro_atribuicoes. O segundo parceiro cai no ON CONFLICT e não
 * sobrescreve. Regra em constraint não tem como ser esquecida numa branch.
 *
 * Público (verify_jwt = false): roda antes de existir conta.
 * Body: { slug, visitante_id, utm?, referer? }
 */

// Origem restrita, diferente do '*' das funções antigas. Esta rota é chamada
// só pela LP/app da Lotti, então não há motivo para qualquer site poder
// disparar cliques e inflar a métrica de um parceiro.
const ORIGENS_PERMITIDAS = (Deno.env.get('PARCEIRO_ORIGENS_PERMITIDAS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function cors(origem: string | null) {
  const permitida =
    origem && (ORIGENS_PERMITIDAS.length === 0 || ORIGENS_PERMITIDAS.includes(origem))
      ? origem
      : (ORIGENS_PERMITIDAS[0] ?? '')

  return {
    'Access-Control-Allow-Origin': permitida,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

serve(async (req) => {
  const cabecalhos = cors(req.headers.get('origin'))

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cabecalhos })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cabecalhos, 'Content-Type': 'application/json' },
    })

  if (req.method !== 'POST') {
    return json({ error: 'método não suportado' }, 405)
  }

  try {
    let corpo: Record<string, unknown> = {}
    try {
      corpo = await req.json()
    } catch {
      return json({ error: 'corpo inválido' }, 400)
    }

    const slug = corpo.slug
    const visitanteId = corpo.visitante_id

    if (!slugValido(slug)) return json({ error: 'slug inválido' }, 400)
    if (!uuidValido(visitanteId)) return json({ error: 'visitante_id inválido' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Link precisa estar ativo E o parceiro também. Um link antigo de parceiro
    // encerrado não pode continuar atribuindo.
    const { data: link, error: erroLink } = await supabase
      .from('parceiro_links')
      .select('id, parceiro_id, ativo, revogado_em, parceiros(id, nome, status, janela_atribuicao_dias)')
      .eq('slug', slug)
      .maybeSingle()

    if (erroLink) throw erroLink

    const parceiro = link?.parceiros as
      | { id: string; nome: string; status: string; janela_atribuicao_dias: number }
      | undefined

    // Resposta idêntica para link inexistente, revogado e parceiro inativo: não
    // dá para descobrir quais slugs existem testando um por um.
    if (!link || !link.ativo || link.revogado_em || !parceiro || parceiro.status !== 'ativo') {
      return json({ ok: false }, 200)
    }

    const salt = Deno.env.get('IP_HASH_SALT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const ipHash = await hashIp(ipDoRequest(req.headers), salt)

    const { error: erroClique } = await supabase.from('parceiro_cliques').insert({
      link_id: link.id,
      parceiro_id: parceiro.id,
      visitante_id: visitanteId,
      ip_hash: ipHash,
      user_agent: truncar(req.headers.get('user-agent'), 400),
      referer: truncar(corpo.referer ?? req.headers.get('referer'), 400),
      utm: limparUtm(corpo.utm),
    })

    // Falhar em gravar o clique não pode impedir a visita de continuar: a
    // métrica é secundária, chegar na página é o que importa.
    if (erroClique) console.error('parceiro-clique: falha ao registrar clique', erroClique.message)

    const janela = parceiro.janela_atribuicao_dias ?? 90
    const expiraEm = new Date(Date.now() + janela * 86_400_000).toISOString()

    // O coração da regra: primeiro clique vence. Conflito = já existe origem
    // para este visitante, e nada é sobrescrito.
    const { error: erroAtribuicao } = await supabase
      .from('parceiro_atribuicoes')
      .insert({
        parceiro_id: parceiro.id,
        link_id: link.id,
        visitante_id: visitanteId,
        modelo: 'primeiro_clique',
        janela_dias: janela,
        expira_em: expiraEm,
        status: 'pendente',
      })

    // 23505 = unique_violation: o visitante já tinha parceiro. Esperado.
    if (erroAtribuicao && erroAtribuicao.code !== '23505') {
      console.error('parceiro-clique: falha na atribuição', erroAtribuicao.message)
    }

    // Devolve só o nome, para a faixa "Você chegou pela indicação de X".
    // parceiro_id e percentual jamais saem daqui.
    return json({ ok: true, parceiro_nome: parceiro.nome })
  } catch (e) {
    console.error('parceiro-clique: erro inesperado', e instanceof Error ? e.message : e)
    return json({ ok: false }, 200)
  }
})
