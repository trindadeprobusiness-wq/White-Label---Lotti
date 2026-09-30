import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.89.0'
import { checarCota, COTA_LEADS } from '../_shared/cotas.ts'
import { consumeLeadLimit, isTrustedIntegration, parseLead, publicLeadResponse, PublicRequestError, readPublicJson } from '../_shared/public-request.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-n8n-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

/**
 * Edge Function: lead-capture (captar-lead)
 *
 * Recebe POST com dados do lead vindo da landing page ou campanhas.
 * - Procura o cliente pelo telefone em qualquer grafia (atualiza ultimo_contato se já existe)
 * - Se novo, cadastra em "clientes" com status_funil = QUALIFICACAO (RPC lead_capture_upsert_cliente)
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
export function createLeadHandler(supabaseClient: Pick<SupabaseClient, 'from' | 'rpc'>, config: { integrationSecret?: string; rateSecret: string }) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }

    if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' } })

    try {
      const trusted = await isTrustedIntegration(req.headers, config.integrationSecret)
      const lead = parseLead(await readPublicJson(req), new URL(req.url).searchParams.get('imovel_id'))
      await consumeLeadLimit(supabaseClient, lead.telefone, config.rateSecret)
      const { nome: clienteNome, telefone: clienteTelefone, email: clienteEmail, mensagem, origem, assunto } = lead
      const trackingData = { ...lead.tracking, origem: origem || 'landing_page', assunto, mensagem, captured_at: new Date().toISOString() }
      const target_imovel_id = lead.imovelId
      let corretor_id: string | undefined

      if (target_imovel_id) {
        const { data: imovelData } = await supabaseClient
          .from('imoveis')
          .select('corretor_id')
          .eq('id', target_imovel_id)
          .single()
        if (!imovelData) throw new PublicRequestError(400, 'Imóvel inválido.')
        corretor_id = imovelData.corretor_id
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
          if (erroOrfao) throw erroOrfao

          return new Response(
            JSON.stringify(publicLeadResponse(trusted, { pendente_triagem: true })),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          )
        }
        corretor_id = corretores[0].id
      }

      // --- Cliente: um por telefone na conta ---
      // Busca e cadastro acontecem numa transação só, no banco, sob a mesma trava
      // do WhatsApp e do CRM: um POST duplo cria um cliente, e o telefone casa em
      // qualquer grafia (máscara, 55 na frente, com ou sem o 9) pela chave
      // DDD + tipo + 8 dígitos, que continua difícil de chutar.
      // SEGURANÇA: este endpoint é PÚBLICO. Um cliente que já existe nunca tem
      // nome ou e-mail trocados por via anônima: a RPC só atualiza ultimo_contato
      // e guarda o que chegou em tracking_data.ultimo_retorno para o corretor revisar.
      const { data: cliente, error: clienteError } = await supabaseClient.rpc('lead_capture_upsert_cliente', {
        p_corretor: corretor_id,
        p_nome: clienteNome,
        p_telefone: clienteTelefone,
        p_email: clienteEmail ?? null,
        p_tracking: trackingData,
      })
      if (clienteError || !cliente?.cliente_id) throw clienteError ?? new Error('lead_capture_upsert_cliente sem cliente')
      const clienteId: string = cliente.cliente_id
      const isNew = cliente.created === true

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

      // Captura não executa IA e, portanto, não pode debitar cota. A integração
      // autenticada recebe uma indicação; o executor deve revalidar e contabilizar
      // a qualificação efetiva uma única vez. Visitantes nem consultam a cota.
      const cota = trusted ? await checarCota(supabaseClient, corretor_id, COTA_LEADS) : null
      const qualificar = cota?.permitido ?? false
      const aviso = cota && !cota.permitido
        ? 'O contato foi salvo. A qualificação automática está indisponível no plano ou a cota acabou.'
        : null

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
        JSON.stringify(publicLeadResponse(trusted, {
          cliente_id: clienteId,
          is_new: isNew,
          // Consumido por quem dispara a conversa no WhatsApp.
          qualificar_com_ia: qualificar,
        })),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    } catch (error: unknown) {
      const status = error instanceof PublicRequestError ? error.status : 500
      const errorMessage = error instanceof PublicRequestError ? error.message : 'Não foi possível receber seu contato. Tente novamente.'
      if (status === 500) console.error('[lead-capture] falha interna ao receber contato')
      return new Response(
        JSON.stringify({ success: false, error: errorMessage }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(status === 429 ? { 'Retry-After': '600' } : {}) }, status }
      )
    }
  }
}
