import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Auth: sem isto, esta função era um proxy ABERTO para a API paga do Gemini
        // (qualquer um na internet gerava texto com prompt próprio à custa da chave).
        // Mesmo padrão robusto da asaas-sync: valida a sessão do corretor in-code.
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }
        const token = authHeader.replace(/^Bearer\s+/i, '').trim()
        const userClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } },
        )
        const { data: { user }, error: authError } = await userClient.auth.getUser(token)
        if (authError || !user) {
            return new Response(JSON.stringify({ error: 'Sua sessão expirou. Entre novamente para continuar.' }), {
                status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        const { clientName, messageType, details, tone } = await req.json()
        const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')

        if (!GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY not configured')
        }

        const systemPrompt = `Você é um assistente profissional de corretor de imóveis. Escreva mensagens curtas e claras para WhatsApp em português brasileiro.

Diretrizes:
- Use emojis apropriados, mas com moderação
- Seja conciso e educado
- Não use linhas de assunto ou placeholders como [Nome]
- Se for lembrete de pagamento, mencione o valor e data de vencimento claramente
- Se for agradecimento, confirme o recebimento do pagamento`

        const userPrompt = `Escreva uma mensagem de WhatsApp para o cliente "${clientName}".

Contexto:
- Tipo de Mensagem: ${messageType === 'reminder' ? 'Lembrete de Vencimento' : messageType === 'late' ? 'Cobrança de Atraso' : messageType === 'thank_you' ? 'Agradecimento de Pagamento' : 'Outro'}
- Tom: ${tone === 'friendly' ? 'Amigável' : tone === 'formal' ? 'Profissional' : 'Incisivo'}
- Detalhes: ${JSON.stringify(details)}`

        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GEMINI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
            }),
        })

        if (!response.ok) {
            if (response.status === 429) {
                return new Response(
                    JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns segundos." }),
                    { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
            if (response.status === 402) {
                return new Response(
                    JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos ao workspace." }),
                    { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
            const errorText = await response.text()
            console.error("Gemini API error:", response.status, errorText)
            throw new Error("Erro ao gerar mensagem com IA")
        }

        const data = await response.json()
        const message = data.choices?.[0]?.message?.content || ""

        return new Response(
            JSON.stringify({ message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Erro desconhecido"
        console.error("generate-whatsapp-message error:", errorMessage)
        return new Response(
            JSON.stringify({ error: errorMessage }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
