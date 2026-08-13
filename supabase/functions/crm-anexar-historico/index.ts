// Edge Function: crm-anexar-historico
// Grava mensagens WhatsApp em `historico_contatos` (tipo=WHATSAPP).
// Auth: header x-n8n-secret

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, assertN8nSecret, json } from '../_shared/auth.ts'

interface HistoricoPayload {
  telefone?: string
  cliente_id?: string
  direcao: 'IN' | 'OUT'
  mensagem: string
  metadata?: Record<string, unknown>
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

    const payload = (await req.json()) as HistoricoPayload
    if (!payload.mensagem) return json({ error: 'mensagem é obrigatória' }, 400)

    let clienteId = payload.cliente_id
    if (!clienteId && payload.telefone) {
      const { data } = await supabase
        .from('clientes')
        .select('id')
        .eq('telefone', payload.telefone)
        .maybeSingle()
      clienteId = data?.id
    }
    if (!clienteId) return json({ error: 'cliente não encontrado; chame crm-upsert-lead antes' }, 404)

    const { data, error } = await supabase
      .from('historico_contatos')
      .insert({
        cliente_id: clienteId,
        tipo: 'WHATSAPP',
        direcao: payload.direcao,
        conteudo: payload.mensagem,
        metadata: payload.metadata ?? {},
        data_contato: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) throw error

    await supabase
      .from('clientes')
      .update({ ultimo_contato: new Date().toISOString() })
      .eq('id', clienteId)

    return json({ success: true, historico_id: data.id, cliente_id: clienteId })
  } catch (err) {
    // @ts-ignore
    const status = err?.status ?? 400
    return json({ success: false, error: (err as Error).message }, status)
  }
})
