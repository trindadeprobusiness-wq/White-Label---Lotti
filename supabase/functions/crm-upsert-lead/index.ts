// Edge Function: crm-upsert-lead
// Recebe payload do n8n (Gemini slot filling) e faz upsert em `clientes`: um cliente por telefone na conta,
// casado em qualquer grafia pela chave do banco (lotti_find_or_create_cliente).
// Auth: header x-n8n-secret

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, assertN8nSecret, json } from '../_shared/auth.ts'
import { salvarClienteDoLead } from './cliente.ts'

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

    // status_funil é ENUM no banco: 'PROPOSTA' e 'PERDIDO' NÃO existem e faziam
    // todo insert falhar. Os valores válidos são QUALIFICACAO, VISITA_PROPOSTA,
    // DOCUMENTACAO, FECHADO_GANHO, FECHADO_PERDIDO.
    const statusFunil =
      payload.classificacao === 'quente'
        ? 'VISITA_PROPOSTA'
        : payload.classificacao === 'descartado'
        ? 'FECHADO_PERDIDO'
        : 'QUALIFICACAO'

    // tipo_interesse também é ENUM (COMPRA | LOCACAO | AMBOS). 'ALUGUEL' e
    // 'PROPRIETARIO', que o n8n envia, precisam ser traduzidos.
    const INTERESSE: Record<string, string> = {
      COMPRA: 'COMPRA', LOCACAO: 'LOCACAO', ALUGUEL: 'LOCACAO',
      AMBOS: 'AMBOS', PROPRIETARIO: 'AMBOS',
    }
    const tipoInteresse = INTERESSE[String(payload.tipo_interesse ?? '').toUpperCase()] ?? 'AMBOS'

    const tracking = {
      origem: 'whatsapp',
      canal: 'evolution_api',
      // Estes campos não existem como coluna em `clientes` e faziam o insert
      // falhar. Ficam no tracking_data, que é jsonb — é de onde a view
      // v_leads_whatsapp já lê a classificação.
      classificacao: payload.classificacao,
      faixa_valor_min: payload.faixa_valor_min,
      faixa_valor_max: payload.faixa_valor_max,
      forma_pagamento: payload.forma_pagamento,
      tempo_decisao: payload.tempo_decisao,
      ...(payload.tracking_data ?? {}),
    }

    // Dedupe SEMPRE dentro do corretor. Sem o filtro por corretor_id, um lead
    // com telefone repetido em outra imobiliária era lido e SOBRESCRITO — este
    // endpoint roda com service_role, então a RLS não segura nada aqui. O
    // helper recebe o corretor explícito e procura só nos clientes dele.
    const { cliente_id: clienteId } = await salvarClienteDoLead(supabase, corretor_id, {
      nome: payload.nome,
      telefone: payload.telefone,
      email: payload.email,
      tipo_interesse: tipoInteresse,
      status_funil: statusFunil,
      observacoes: payload.observacoes,
      tracking,
    })

    // Vincula ao imóvel se informado
    if (payload.imovel_interesse) {
      await supabase.from('cliente_imovel').upsert(
        { cliente_id: clienteId, imovel_id: payload.imovel_interesse },
        { onConflict: 'cliente_id,imovel_id' }
      )
    }

    // Alerta automático para leads quentes.
    // 'LEAD_QUENTE' não existe no enum tipo_alerta (FOLLOWUP | DOCUMENTO |
    // EXCLUSIVIDADE | GERAL) — o insert falhava calado. FOLLOWUP é o que
    // descreve a ação esperada: retornar o contato.
    if (payload.classificacao === 'quente') {
      const { error } = await supabase.from('alertas').insert({
        cliente_id: clienteId,
        corretor_id,
        tipo: 'FOLLOWUP',
        // `prioridade` NÃO é enviado de propósito: o schema_probe de produção
        // mostra `alertas` sem essa coluna, enquanto a migration base a cria com
        // default. Omitir funciona nos dois casos; enviar quebra num deles.
        mensagem: `Lead quente via WhatsApp: ${payload.nome ?? 'Lead WhatsApp'} (${payload.telefone})`,
        lido: false,
      })
      if (error) console.error('Falha ao criar alerta do lead quente:', error)
    }

    return json({ success: true, cliente_id: clienteId, classificacao: payload.classificacao })
  } catch (err) {
    // @ts-ignore
    const status = err?.status ?? 400
    return json({ success: false, error: (err as Error).message }, status)
  }
})
