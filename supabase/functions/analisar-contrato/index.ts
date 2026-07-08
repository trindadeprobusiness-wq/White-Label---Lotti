import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
// PDFs de contrato podem ter várias páginas; o limite do Gemini para
// inline_data é ~20MB por request, então 15M de base64 é uma margem segura.
const MAX_BASE64_LENGTH = 15_000_000;

const EXTRACTION_PROMPT = `Você é um assistente especializado em contratos de locação de imóveis no Brasil.
Analise o contrato anexado (PDF ou imagem) e extraia os dados abaixo.

Retorne APENAS um objeto JSON (sem markdown, sem explicação) exatamente neste formato:
{
  "inquilino": {
    "nome": "<nome completo do inquilino/locatário, ou null>",
    "cpf": "<CPF do inquilino, ou null>",
    "telefone": "<telefone do inquilino, ou null>",
    "email": "<email do inquilino, ou null>"
  },
  "proprietario_nome": "<nome do proprietário/locador, ou null>",
  "imovel": {
    "endereco": "<endereço completo do imóvel (rua e número), ou null>",
    "bairro": "<bairro, ou null>",
    "cidade": "<cidade, ou null>",
    "tipo": "<APARTAMENTO | CASA | COMERCIAL | TERRENO, ou null>"
  },
  "valor_aluguel": <valor mensal do aluguel em reais, número, ou null>,
  "data_inicio": "<data de início da locação no formato YYYY-MM-DD, ou null>",
  "prazo_meses": <duração do contrato em meses, número inteiro, ou null>,
  "dia_vencimento": <dia do mês de vencimento do aluguel, inteiro 1-31, ou null>,
  "taxa_administracao": <percentual da taxa de administração da imobiliária, número, ou null>,
  "observacoes": "<resumo de 1 frase de cláusulas relevantes (garantia, reajuste, multa), ou null>"
}

Regras:
- Use null para qualquer campo que não conseguir identificar com segurança. NUNCA invente dados.
- Valores monetários como número puro (ex.: 1500.00), sem "R$" e sem separador de milhar.
- Se o contrato indicar apenas a data de assinatura e não a de início, use-a como data_inicio.
- "inquilino" é o LOCATÁRIO (quem paga o aluguel); "proprietario_nome" é o LOCADOR.`;

interface DadosContrato {
  inquilino: { nome: string | null; cpf: string | null; telefone: string | null; email: string | null };
  proprietario_nome: string | null;
  imovel: { endereco: string | null; bairro: string | null; cidade: string | null; tipo: string | null };
  valor_aluguel: number | null;
  data_inicio: string | null;
  prazo_meses: number | null;
  dia_vencimento: number | null;
  taxa_administracao: number | null;
  observacoes: string | null;
}

const TIPOS_IMOVEL = ["APARTAMENTO", "CASA", "COMERCIAL", "TERRENO"];

function asString(v: unknown, max = 300): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function asNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (typeof n !== "number" || !isFinite(n)) return null;
  return n >= min && n <= max ? n : null;
}

function sanitizeExtraction(raw: Record<string, unknown>): DadosContrato {
  const inq = (raw.inquilino ?? {}) as Record<string, unknown>;
  const imo = (raw.imovel ?? {}) as Record<string, unknown>;
  const tipoImovel = asString(imo.tipo)?.toUpperCase() ?? null;
  const dataInicio = asString(raw.data_inicio);

  return {
    inquilino: {
      nome: asString(inq.nome),
      cpf: asString(inq.cpf, 20),
      telefone: asString(inq.telefone, 30),
      email: asString(inq.email, 120),
    },
    proprietario_nome: asString(raw.proprietario_nome),
    imovel: {
      endereco: asString(imo.endereco),
      bairro: asString(imo.bairro, 120),
      cidade: asString(imo.cidade, 120),
      tipo: tipoImovel && TIPOS_IMOVEL.includes(tipoImovel) ? tipoImovel : null,
    },
    valor_aluguel: asNumber(raw.valor_aluguel, 1, 10_000_000),
    data_inicio: dataInicio && /^\d{4}-\d{2}-\d{2}$/.test(dataInicio) ? dataInicio : null,
    prazo_meses: asNumber(raw.prazo_meses, 1, 120),
    dia_vencimento: asNumber(raw.dia_vencimento, 1, 31),
    taxa_administracao: asNumber(raw.taxa_administracao, 0, 100),
    observacoes: asString(raw.observacoes, 500),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Autenticação: só corretores logados podem usar.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid session" }, 401);

    const { fileBase64, mimeType } = await req.json();

    if (typeof fileBase64 !== "string" || fileBase64.length === 0 || fileBase64.length > MAX_BASE64_LENGTH) {
      return jsonResponse({ error: "Arquivo inválido ou muito grande" }, 400);
    }
    if (typeof mimeType !== "string" || !ALLOWED_MIME.includes(mimeType)) {
      return jsonResponse({ error: "Formato inválido. Envie PDF ou imagem (JPG, PNG, WEBP)." }, 400);
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY não configurada" }, 500);
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: EXTRACTION_PROMPT },
              { inline_data: { mime_type: mimeType, data: fileBase64 } },
            ],
          }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1,
            maxOutputTokens: 1024,
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini extraction failed:", response.status, errText);
      return jsonResponse({ error: "Falha ao analisar o contrato com a IA" }, 502);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Gemini returned non-JSON:", cleaned.slice(0, 500));
      return jsonResponse({ error: "A IA não conseguiu estruturar os dados do contrato" }, 502);
    }

    return jsonResponse({ dados: sanitizeExtraction(parsed) });
  } catch (error) {
    console.error("analisar-contrato error:", error);
    return jsonResponse({ error: "Erro interno ao analisar contrato" }, 500);
  }
});
