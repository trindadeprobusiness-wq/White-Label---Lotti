import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { liberarQualificacao } from '../_shared/cotas.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Edge Function: lead-capture (captar-lead)
 * 
 * Recebe POST com dados do lead vindo da landing page ou campanhas.
 * - Verifica duplicata por telefone (atualiza ultimo_contato se já existe)
 * - Se novo, insere na tabela "clientes" com status_funil = QUALIFICACAO
 * - Cria alerta LEAD_QUENTE para o corretor
 * - Se imovel_interesse_id fornecido, vincula na tabela cliente_imovel
 * 
 * Payload:
 * {
 *   nome: string (obrigatório),
 *   telefone: string (obrigatório),
 *   email?: string,
 *   mensagem?: string,
 *   imovel_interesse_id?: string (uuid),
 *   origem?: string,
 *   tracking_data?: { interesse, faixa_preco, bairro_interesse, utm_source, utm_medium, utm_campaign, ... }
 * }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse URL for optional query params
    const url = new URL(req.url)
    const imovel_id_query = url.searchParams.get('imovel_id')

    // Parse body
    let payload: any = {}
    try {
      payload = await req.json()
    } catch (_e) {
      payload = {}
    }

    const {
      nome,
      email,
      telefone,
      celular,
      phone,
      first_name,
      last_name,
      mensagem,
      imovel_interesse_id,
      origem,
      tracking_data: incomingTracking,
      // Legacy fields for backward compat
      utm_source,
      utm_campaign,
      utm_medium,
      fbclid,
      gclid,
      assunto,
      ...otherData
    } = payload

    // --- Normalizar dados ---
    const clienteNome = nome || (first_name ? `${first_name} ${last_name || ''}`.trim() : 'Lead de Campanha')
    const clienteEmail = email || undefined

    // Normalizar telefone: aceitar vários formatos, converter para 55+DDD+número
    const rawPhone = telefone || celular || phone || ''
    const digitsOnly = rawPhone.replace(/\D/g, '')
    let clienteTelefone = rawPhone

    if (digitsOnly.length >= 10) {
      if (digitsOnly.length === 11) {
        // DDD + 9 dígitos: 62999998888
        clienteTelefone = `55${digitsOnly}`
      } else if (digitsOnly.length === 10) {
        // DDD + 8 dígitos (fixo): 6232228888
        clienteTelefone = `55${digitsOnly}`
      } else if (digitsOnly.length === 13 && digitsOnly.startsWith('55')) {
        // Já no formato correto
        clienteTelefone = digitsOnly
      } else {
        clienteTelefone = digitsOnly
      }
    }

    // Validações
    if (!clienteNome || clienteNome.length < 2) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nome é obrigatório (mínimo 2 caracteres)' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (!clienteTelefone || clienteTelefone.replace(/\D/g, '').length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Telefone é obrigatório (mínimo 10 dígitos)' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Montar tracking_data completo
    const trackingData = {
      ...(incomingTracking || {}),
      utm_source: incomingTracking?.utm_source || utm_source || undefined,
      utm_campaign: incomingTracking?.utm_campaign || utm_campaign || undefined,
      utm_medium: incomingTracking?.utm_medium || utm_medium || undefined,
      fbclid: incomingTracking?.fbclid || fbclid || undefined,
      gclid: incomingTracking?.gclid || gclid || undefined,
      origem: origem || 'landing_page',
      assunto: assunto || undefined,
      mensagem: mensagem || undefined,
      captured_at: new Date().toISOString(),
      payload_extra: Object.keys(otherData).length > 0 ? otherData : undefined,
    }

    // --- Encontrar corretor ---
    const target_imovel_id = imovel_id_query || imovel_interesse_id || payload.imovel_id
    let corretor_id: string | undefined

    if (target_imovel_id) {
      const { data: imovelData } = await supabaseClient
        .from('imoveis')
        .select('corretor_id')
        .eq('id', target_imovel_id)
        .single()
      if (imovelData) corretor_id = imovelData.corretor_id
    }

    // Sem imóvel no payload, cai no corretor padrão. Antes era "o primeiro da
    // tabela": com um único corretor funciona, mas a partir do segundo o lead
    // iria para o tenant ERRADO, sem ninguém perceber. Agora só assume o padrão
    // se existir exatamente UM corretor; havendo mais, falha explicitamente.
    if (!corretor_id) {
      const { data: corretores } = await supabaseClient
        .from('corretores')
        .select('id')
        .limit(2)

      if (!corretores?.length) {
        throw new Error('Não foi possível encontrar um corretor para atribuir.')
      }
      if (corretores.length > 1) {
        // Fail-closed é a decisão certa — atribuir o lead ao corretor errado
        // seria pior. Mas o formulário da landing não pode simplesmente sumir
        // com o contato: o visitante preencheu e foi embora achando que enviou.
        //
        // O lead é guardado sem dono para triagem, e a resposta segue 200 para
        // o formulário não exibir erro a quem não tem culpa nem conserto.
        console.error('[lead-capture] lead sem destinatário: mais de um corretor e sem imovel_id')
        const { error: erroOrfao } = await supabaseClient.from('leads_sem_destino').insert({
          nome: clienteNome,
          telefone: clienteTelefone,
          email: clienteEmail ?? null,
          mensagem: mensagem ?? null,
          tracking_data: trackingData ?? {},
          motivo: 'multiplos_corretores_sem_imovel_id',
        })
        if (erroOrfao) console.error('[lead-capture] falha ao guardar lead órfão:', erroOrfao)

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Recebemos seu contato! Em breve alguém falará com você.',
            pendente_triagem: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      corretor_id = corretores[0].id
    }

    // --- Verificar duplicata por telefone ---
    // SEGURANÇA: este endpoint é PÚBLICO e roda com service_role. O match usava só os
    // 8 últimos dígitos, o que é facilmente colidível/adivinhável — um terceiro acertava
    // o sufixo e caía no registro de um cliente real. Agora casa pelo número local
    // completo (DDD + número = 11 dígitos), reduzindo drasticamente colisão e chute.
    const phoneLookup = clienteTelefone.replace(/\D/g, '')
    const { data: existingCliente } = await supabaseClient
      .from('clientes')
      .select('id, nome, tracking_data')
      .eq('corretor_id', corretor_id)
      .ilike('telefone', `%${phoneLookup.slice(-11)}%`)
      .limit(1)
      .maybeSingle()

    let clienteId: string
    let isNew = false

    if (existingCliente) {
      // Atualizar cliente existente
      const mergedTracking = {
        ...(existingCliente.tracking_data || {}),
        ultimo_retorno: { ...trackingData, email_informado: clienteEmail || undefined },
      }

      // SEGURANÇA: nunca sobrescrever PII de um cliente já existente por via anônima.
      // Antes, um POST público conseguia trocar o e-mail de um cliente real. O e-mail
      // enviado fica registrado apenas dentro de tracking_data (append), para o corretor
      // revisar manualmente, sem adulterar o cadastro.
      const { error: updateError } = await supabaseClient
        .from('clientes')
        .update({
          ultimo_contato: new Date().toISOString(),
          tracking_data: mergedTracking,
        })
        .eq('id', existingCliente.id)

      if (updateError) throw updateError
      clienteId = existingCliente.id
    } else {
      // Criar novo cliente
      isNew = true
      const { data: novoCliente, error: clienteError } = await supabaseClient
        .from('clientes')
        .insert({
          nome: clienteNome,
          telefone: clienteTelefone,
          email: clienteEmail,
          tipo_interesse: 'AMBOS',
          status_funil: 'QUALIFICACAO',
          corretor_id,
          tracking_data: trackingData,
          ultimo_contato: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (clienteError) throw clienteError
      clienteId = novoCliente.id
    }

    // --- Vincular imóvel (se fornecido) ---
    if (target_imovel_id) {
      await supabaseClient
        .from('cliente_imovel')
        .upsert(
          { cliente_id: clienteId, imovel_id: target_imovel_id },
          { onConflict: 'cliente_id,imovel_id' }
        )
        .select()
    }

    // --- Criar alerta ---
    try {
      const tipoLabel = isNew ? 'NOVO lead' : 'Retorno de lead'
      await supabaseClient.from('alertas').insert({
        cliente_id: clienteId,
        corretor_id,
        tipo: 'GERAL', // Usando tipo existente no enum
        mensagem: `${tipoLabel} do site: ${clienteNome} (${clienteTelefone}) — ${origem || assunto || 'direto'}`,
        lido: false,
        metadata: {
          lead_type: isNew ? 'new' : 'returning',
          source: origem || 'landing_page',
          tracking: trackingData,
        },
      })
    } catch (alertError) {
      console.error('Erro ao criar alerta:', alertError)
    }

    // --- Cota de qualificação por IA ---
    //
    // Vem DEPOIS de o lead estar gravado, e nunca antes: cota não bloqueia
    // captura. O contato é do corretor; barrar a gravação para forçar upgrade
    // destruiria o ativo dele, e ele nem descobriria — o lead sumiria calado.
    //
    // O que a cota decide é se a IA conversa com este lead, que é onde está o
    // custo de verdade.
    const { qualificar, aviso } = await liberarQualificacao(supabaseClient, corretor_id)

    if (aviso) {
      // Um alerta por mês basta. Repetir a cada lead transformaria o aviso em
      // ruído justamente quando ele precisa ser notado.
      try {
        const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
        const { data: jaAvisado } = await supabaseClient
          .from('alertas')
          .select('id')
          .eq('corretor_id', corretor_id)
          .eq('entidade_tipo', 'plano')
          .gte('created_at', inicioMes)
          .limit(1)

        if (!jaAvisado?.length) {
          await supabaseClient.from('alertas').insert({
            corretor_id,
            tipo: 'GERAL',
            prioridade: 'ALTA',
            mensagem: aviso,
            lido: false,
            origem: 'sistema',
            entidade_tipo: 'plano',
          })
        }
      } catch (e) {
        console.error('aviso de cota falhou (lead segue gravado)', e)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: isNew ? 'Lead capturado com sucesso!' : 'Lead atualizado com sucesso!',
        cliente_id: clienteId,
        is_new: isNew,
        // Consumido por quem dispara a conversa no WhatsApp.
        qualificar_com_ia: qualificar,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
