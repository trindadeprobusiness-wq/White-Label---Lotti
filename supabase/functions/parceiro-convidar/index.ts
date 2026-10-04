import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const allowed = (Deno.env.get('PARCEIRO_ORIGENS_PERMITIDAS') ?? '')
  .split(',').map((item) => item.trim()).filter(Boolean)

function cors(origin: string | null) {
  const accepted = origin && (allowed.length === 0 || allowed.includes(origin)) ? origin : (allowed[0] ?? '')
  return {
    'Access-Control-Allow-Origin': accepted,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

serve(async (req) => {
  const headers = cors(req.headers.get('origin'))
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, 'Content-Type': 'application/json' },
  })
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  if (req.method !== 'POST') return json({ error: 'método não suportado' }, 405)

  let persistedPartnerId: string | null = null
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'não autenticado' }, 401)
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: auth, error: authError } = await userClient.auth.getUser(token)
    if (authError || !auth.user) return json({ error: 'não autenticado' }, 401)

    const { data: isAdmin, error: roleError } = await userClient.rpc('is_admin')
    if (roleError || !isAdmin) return json({ error: 'acesso negado' }, 403)

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    let partnerId = typeof body?.parceiro_id === 'string' ? body.parceiro_id : ''
    if (body?.acao === 'criar') {
      const { data: created, error: createError } = await userClient.rpc('admin_criar_parceiro_completo', { p_dados: body.dados })
      if (createError || !created?.parceiro_id) {
        return json({ error: createError?.code === '23505'
          ? 'Já existe parceiro com este e-mail ou identificador de link.'
          : 'Não foi possível criar o parceiro. Confira os dados e tente novamente.' }, 400)
      }
      partnerId = created.parceiro_id
      persistedPartnerId = partnerId
    }
    if (!/^[0-9a-f-]{36}$/i.test(partnerId)) return json({ error: 'parceiro inválido' }, 400)
    const { data: partner, error: partnerError } = await admin.from('parceiros')
      .select('id,nome,email,status,user_id,convite_status')
      .eq('id', partnerId).single()
    if (partnerError || !partner) return json({ error: 'parceiro não encontrado' }, 404)
    persistedPartnerId = partner.id
    if (partner.status !== 'ativo') return json({ error: 'ative o parceiro antes de enviar o convite' }, 409)
    if (partner.convite_status === 'aceito') return json({ error: 'este parceiro já aceitou o convite' }, 409)

    const { data: terms } = await admin.from('parceiro_percentuais')
      .select('percentual,base_calculo,valor_fixo,teto_renovacoes').eq('parceiro_id', partner.id)
      .is('vigencia_fim', null).maybeSingle()
    const { data: link } = await admin.from('parceiro_links').select('slug')
      .eq('parceiro_id', partner.id).eq('principal', true).eq('ativo', true).is('revogado_em', null).maybeSingle()
    const appUrl = (Deno.env.get('PARCEIRO_APP_URL') ?? 'https://app.plataformalotti.com.br').replace(/\/$/, '')
    const partnerLink = link?.slug ? `${appUrl}/r/${link.slug}` : ''
    const rule = terms?.base_calculo === 'primeiro_pagamento'
      ? 'Somente o primeiro pagamento de cada indicado gera comissão.'
      : terms?.teto_renovacoes == null
        ? 'A comissão também vale para as renovações enquanto esta regra estiver vigente.'
        : `A comissão vale para o primeiro pagamento e até ${terms.teto_renovacoes} renovações por indicado.`

    const redirectTo = Deno.env.get('PARCEIRO_PORTAL_URL') ?? 'https://app.plataformalotti.com.br/nova-senha?redirectTo=%2Fparceiro'
    const { data: invited, error: inviteError } = partner.user_id
      ? { data: null, error: new Error('existing_account') }
      : await admin.auth.admin.inviteUserByEmail(partner.email, {
      redirectTo,
      data: {
        tipo_acesso: 'parceiro', parceiro_id: partner.id, nome_parceiro: partner.nome,
        comissao: terms?.base_calculo === 'valor_fixo' ? `R$ ${Number(terms.valor_fixo).toFixed(2)}` : `${Number(terms?.percentual ?? 0)}%`,
        regra_renovacao: rule,
        link_parceiro: partnerLink,
      },
    })
    if (inviteError) {
      const existing = !!partner.user_id || /already|registered|exists/i.test(inviteError.message)
      if (existing) {
        const { data: generated, error: generateError } = await admin.auth.admin.generateLink({
          type: 'magiclink', email: partner.email, options: { redirectTo },
        })
        if (generateError || !generated.user) {
          await admin.from('parceiros').update({ convite_status: 'falhou' }).eq('id', partner.id)
          return json({ ok: false, parceiro_id: partner.id, email_enviado: false,
            error: 'Parceiro cadastrado, mas não foi possível preparar o acesso. Confira a autenticação e reenvie pelo cadastro.' })
        }
        const metadata = {
          ...(generated.user.user_metadata ?? {}), tipo_acesso: 'parceiro', parceiro_id: partner.id,
          nome_parceiro: partner.nome,
          comissao: terms?.base_calculo === 'valor_fixo' ? `R$ ${Number(terms.valor_fixo).toFixed(2)}` : `${Number(terms?.percentual ?? 0)}%`,
          regra_renovacao: rule,
          link_parceiro: partnerLink,
        }
        const { error: metadataError } = await admin.auth.admin.updateUserById(generated.user.id, { user_metadata: metadata })
        if (metadataError) throw metadataError
        const { error: emailError } = await userClient.auth.signInWithOtp({
          email: partner.email, options: { emailRedirectTo: `${appUrl}/parceiro`, shouldCreateUser: false },
        })
        if (emailError) {
          await admin.from('parceiros').update({ convite_status: 'falhou' }).eq('id', partner.id)
          return json({ ok: false, parceiro_id: partner.id, email_enviado: false,
            error: 'Parceiro cadastrado, mas o e-mail não foi enviado. Confira o provedor e reenvie pelo cadastro.' })
        }
        const { error: attachExistingError } = await admin.from('parceiros').update({
          user_id: generated.user.id, convidado_em: new Date().toISOString(),
          convite_status: 'enviado',
        }).eq('id', partner.id)
        if (attachExistingError) throw attachExistingError
        return json({ ok: true, email: partner.email, existing_account: true, parceiro_id: partner.id })
      }
      await admin.from('parceiros').update({ convite_status: 'falhou' }).eq('id', partner.id)
      return json({ ok: false, parceiro_id: partner.id, email_enviado: false,
        error: 'Parceiro criado, mas o e-mail não foi aceito pelo provedor. Use Reenviar convite no cadastro.' })
    }

    if (!invited?.user) throw new Error('invite_user_missing')
    const { error: attachError } = await admin.from('parceiros').update({
      user_id: invited.user.id,
      convidado_em: new Date().toISOString(), convite_status: 'enviado',
    }).eq('id', partner.id).is('user_id', null)
    if (attachError) throw attachError
    return json({ ok: true, email: partner.email, parceiro_id: partner.id })
  } catch (error) {
    console.error('parceiro-convidar: erro interno', error instanceof Error ? error.message : 'unknown')
    if (persistedPartnerId) return json({
      ok: false, parceiro_id: persistedPartnerId, email_enviado: false,
      error: 'Cadastro salvo. O envio do convite não pôde ser confirmado; confira o cadastro antes de reenviar.',
    })
    return json({ error: 'não foi possível emitir o convite' }, 500)
  }
})
