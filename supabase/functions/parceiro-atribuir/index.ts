import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { uuidValido, motivoDeInvalidez } from '../_shared/parceiro.ts'

/**
 * Edge Function: parceiro-atribuir
 *
 * Fecha o vínculo entre a atribuição pendente e o usuário que acabou de criar
 * a conta.
 *
 * O ponto de segurança: o cliente manda APENAS o visitante_id — um UUID opaco
 * gerado no navegador, sem privilégio nenhum. Quem é o parceiro, quanto vale a
 * comissão e se a janela ainda está aberta, tudo isso o servidor lê do registro
 * que ele mesmo gravou em parceiro-clique. Forjar um visitante_id só permite se
 * atribuir a um clique que a própria pessoa fez.
 *
 * Idempotente por construção: UNIQUE(user_id) e UNIQUE(corretor_id) em
 * parceiro_atribuicoes. Chamar dez vezes tem o mesmo efeito de chamar uma.
 * Isso importa porque o app dispara no SIGNED_IN, que acontece a cada login.
 *
 * Exige JWT: só um usuário autenticado pode reivindicar a própria origem.
 * Body: { visitante_id }
 */

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

  if (req.method !== 'POST') return json({ error: 'método não suportado' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'não autenticado' }, 401)

    // getUser(token) com o token explícito. O repositório já documenta em três
    // arquivos que getUser() sem argumento não é confiável.
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const clienteUsuario = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )
    const { data: dadosUsuario, error: erroAuth } = await clienteUsuario.auth.getUser(token)

    if (erroAuth || !dadosUsuario?.user) return json({ error: 'não autenticado' }, 401)
    const usuario = dadosUsuario.user

    let corpo: Record<string, unknown> = {}
    try {
      corpo = await req.json()
    } catch {
      return json({ error: 'corpo inválido' }, 400)
    }

    const visitanteId = corpo.visitante_id
    if (!uuidValido(visitanteId)) return json({ error: 'visitante_id inválido' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Já atribuído: sucesso silencioso. O app chama a cada login, e a segunda
    // chamada não é um erro — é o estado esperado.
    const { data: existente } = await supabase
      .from('parceiro_atribuicoes')
      .select('id, parceiro_id, status')
      .eq('user_id', usuario.id)
      .maybeSingle()

    if (existente) {
      return json({ ok: true, ja_atribuido: true })
    }

    const { data: atribuicao, error: erroBusca } = await supabase
      .from('parceiro_atribuicoes')
      .select('id, parceiro_id, expira_em, status, user_id, parceiros(id, nome, status, email, user_id)')
      .eq('visitante_id', visitanteId)
      .maybeSingle()

    if (erroBusca) throw erroBusca

    // Sem clique registrado, ou já reivindicada por outra conta: nada a fazer.
    if (!atribuicao || atribuicao.user_id || atribuicao.status !== 'pendente') {
      return json({ ok: false })
    }

    const parceiro = atribuicao.parceiros as
      | { id: string; nome: string; status: string; email: string | null; user_id: string | null }
      | undefined

    if (!parceiro) return json({ ok: false })

    const { data: corretor } = await supabase
      .from('corretores')
      .select('id, email')
      .eq('user_id', usuario.id)
      .maybeSingle()

    const invalidez = motivoDeInvalidez({
      statusParceiro: parceiro.status,
      expiraEm: atribuicao.expira_em,
      emailParceiro: parceiro.email,
      emailCorretor: corretor?.email ?? usuario.email ?? null,
      userIdParceiro: parceiro.user_id,
      userIdCorretor: usuario.id,
    })

    if (invalidez) {
      // Invalidar em vez de apagar: a tentativa fica registrada, o que importa
      // quando o motivo é autoindicação.
      await supabase
        .from('parceiro_atribuicoes')
        .update({ status: 'invalidada', motivo_invalidacao: invalidez })
        .eq('id', atribuicao.id)

      return json({ ok: false })
    }

    const { error: erroUpdate } = await supabase
      .from('parceiro_atribuicoes')
      .update({
        user_id: usuario.id,
        corretor_id: corretor?.id ?? null,
        status: 'convertida',
        convertido_em: new Date().toISOString(),
      })
      .eq('id', atribuicao.id)
      // Só converte se ainda estiver pendente e sem dono: se duas chamadas
      // correrem juntas, a segunda não sobrescreve a primeira.
      .eq('status', 'pendente')
      .is('user_id', null)

    if (erroUpdate) {
      // 23505 aqui = outra conta ganhou a corrida pelo mesmo visitante.
      if (erroUpdate.code === '23505') return json({ ok: false })
      throw erroUpdate
    }

    return json({ ok: true, parceiro_nome: parceiro.nome })
  } catch (e) {
    console.error('parceiro-atribuir: erro inesperado', e instanceof Error ? e.message : e)
    // Nunca quebra o login: a atribuição é secundária ao usuário entrar.
    return json({ ok: false }, 200)
  }
})
