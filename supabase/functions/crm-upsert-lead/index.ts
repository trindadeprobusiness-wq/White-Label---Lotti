// Edge Function: crm-upsert-lead
// Recebe payload do n8n (Gemini slot filling) e faz upsert em `clientes` usando `telefone` como chave natural.
// Auth: header x-n8n-secret

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, assertN8nSecret, json } from '../_shared/auth.ts'

interface LeadPayload {
  telefone: string
  corretor_id?: string
  nome?: string
  email?: string
  tipo_interesse?: 'COMPRA' | 'ALUGUEL' | 'AMBOS' | 'PROPRIETARIO'
  faixa_valor_min?: number
  faixa_valor_max?: number
  forma_pagamento?: string
  tempo_decisao?: string
  imovel_interesse?: string
  classificacao?: 'quente' | 'morno' | 'frio' | 'descartado'
  observacoes?: string
  tracking_data?: Record<string, unknown>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    assertN8nSecret(req)
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const payload = (await req.json()) as LeadPayload
    if (!payload.telefone) return json({ error: 'telefone é obrigatório' }, 400)

    // Resolve o corretor dono do lead.
    // Antes usava "o primeiro corretor da tabela" como padrão: com um único
    // corretor isso funciona, mas a partir do segundo o lead cairia no tenant
    // ERRADO, silenciosamente. Agora: usa o corretor_id explícito quando vier;
    // senão só assume o padrão se existir exatamente UM corretor; havendo mais,
    // falha alto pedindo o corretor_id em vez de adivinhar.
    let corretor_id = payload.corretor_id
    if (corretor_id) {
      const { data: alvo } = await supabase.from('corretores').select('id').eq('id', corretor_id).maybeSingle()
      if (!alvo) return json({ error: 'corretor_id informado não existe' }, 400)
    } else {
      const { data: corretores } = await supabase.from('corretores').select('id').limit(2)
      if (!corretores?.length) return json({ error: 'nenhum corretor cadastrado' }, 500)
      if (corretores.length > 1) {
        return json({ error: 'Há mais de um corretor cadastrado: informe corretor_id no payload.' }, 400)
      }
      corretor_id = corretores[0].id
    }

    const statusFunil =
      payload.classificacao === 'quente'
        ? 'PROPOSTA'
        : payload.classificacao === 'descartado'
        ? 'PERDIDO'
        : 'QUALIFICACAO'

    const tracking = {
      origem: 'whatsapp',
      canal: 'evolution_api',
      ...(payload.tracking_data ?? {}),
    }

    // Upsert por telefone
    const { data: existing } = await supabase
      .from('clientes')
      .select('id, tracking_data')
      .eq('telefone', payload.telefone)
      .maybeSingle()

    const registro = {
      nome: payload.nome ?? 'Lead WhatsApp',
      telefone: payload.telefone,
      email: payload.email,
      tipo_interesse: payload.tipo_interesse ?? 'AMBOS',
      status_funil: statusFunil,
      classificacao: payload.classificacao,
      faixa_valor_min: payload.faixa_valor_min,
      faixa_valor_max: payload.faixa_valor_max,
      forma_pagamento: payload.forma_pagamento,
      tempo_decisao: payload.tempo_decisao,
      observacoes: payload.observacoes,
      corretor_id,
      ultimo_contato: new Date().toISOString(),
      tracking_data: { ...(existing?.tracking_data ?? {}), ...tracking },
    }

    let clienteId: string
    if (existing) {
      const { error } = await supabase.from('clientes').update(registro).eq('id', existing.id)
      if (error) throw error
      clienteId = existing.id
    } else {
      const { data, error } = await supabase.from('clientes').insert(registro).select('id').single()
      if (error) throw error
      clienteId = data.id
    }

    // Vincula ao imóvel se informado
    if (payload.imovel_interesse) {
      await supabase.from('cliente_imovel').upsert(
        { cliente_id: clienteId, imovel_id: payload.imovel_interesse },
        { onConflict: 'cliente_id,imovel_id' }
      )
    }

    // Alerta automático para leads quentes
    if (payload.classificacao === 'quente') {
      await supabase.from('alertas').insert({
        cliente_id: clienteId,
        corretor_id,
        tipo: 'LEAD_QUENTE',
        mensagem: `Lead quente via WhatsApp: ${registro.nome} (${payload.telefone})`,
        lido: false,
      })
    }

    return json({ success: true, cliente_id: clienteId, classificacao: payload.classificacao })
  } catch (err) {
    // @ts-ignore
    const status = err?.status ?? 400
    return json({ success: false, error: (err as Error).message }, status)
  }
})
