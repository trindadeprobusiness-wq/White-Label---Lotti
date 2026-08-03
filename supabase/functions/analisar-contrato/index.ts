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

// ─── Modo "central": contratos de venda / exclusividade / intermediação ───
const CENTRAL_PROMPT = `Você é um assistente especializado em contratos imobiliários no Brasil
(compra e venda, exclusividade de captação, intermediação, distrato, procuração).
Analise o contrato anexado (PDF ou imagem) e extraia os dados abaixo.

Retorne APENAS um objeto JSON (sem markdown, sem explicação) exatamente neste formato:
{
  "tipo": "<COMPRA_VENDA | EXCLUSIVIDADE_VENDA | EXCLUSIVIDADE_LOCACAO | LOCACAO_RESIDENCIAL | LOCACAO_COMERCIAL | DISTRATO | PROCURACAO | OUTRO, ou null>",
  "partes": {
    "vendedor_proprietario": "<nome do vendedor / proprietário / outorgante, ou null>",
    "comprador_cliente": "<nome do comprador / cliente / interessado, ou null>",
    "corretor": "<nome do corretor ou imobiliária, ou null>"
  },
  "imovel": { "endereco": "<endereço do imóvel, ou null>", "cidade": "<cidade, ou null>" },
  "valor": <valor do negócio / venda em reais (número), ou null>,
  "comissao_percentual": <percentual de comissão do corretor, número, ou null>,
  "data_inicio": "<data de assinatura / início no formato YYYY-MM-DD, ou null>",
  "data_fim": "<data de VENCIMENTO: fim da exclusividade / prazo final YYYY-MM-DD, ou null>",
  "prazo_dias": <prazo total em dias (ex.: exclusividade de 90 dias), inteiro, ou null>,
  "observacoes": "<resumo de 1-2 frases: objeto, prazo, renovação, multa/rescisão, ou null>"
}

Regras:
- Use null para qualquer campo que não conseguir identificar com segurança. NUNCA invente dados.
- "data_fim" é o campo MAIS IMPORTANTE: é a data até quando o contrato/exclusividade é válido.
  Se houver apenas data_inicio + prazo, calcule a data_fim.
- Contrato de EXCLUSIVIDADE = autorização de venda/captação com prazo determinado.
- Valores monetários como número puro (ex.: 350000.00), sem "R$" e sem separador de milhar.`;

const TIPOS_CONTRATO = [
  "COMPRA_VENDA", "LOCACAO_RESIDENCIAL", "LOCACAO_COMERCIAL",
  "EXCLUSIVIDADE_VENDA", "EXCLUSIVIDADE_LOCACAO", "DISTRATO", "PROCURACAO", "OUTRO",
];

interface DadosContratoCentral {
  tipo: string | null;
  partes: { vendedor_proprietario: string | null; comprador_cliente: string | null; corretor: string | null };
  imovel: { endereco: string | null; cidade: string | null };
  valor: number | null;
  comissao_percentual: number | null;
  data_inicio: string | null;
  data_fim: string | null;
  prazo_dias: number | null;
  observacoes: string | null;
}

function asDate(v: unknown): string | null {
  const s = asString(v, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sanitizeCentral(raw: Record<string, unknown>): DadosContratoCentral {
  const partes = (raw.partes ?? {}) as Record<string, unknown>;
  const imo = (raw.imovel ?? {}) as Record<string, unknown>;
  const tipo = asString(raw.tipo)?.toUpperCase() ?? null;
  const dataInicio = asDate(raw.data_inicio);
  let dataFim = asDate(raw.data_fim);
  const prazoDias = asNumber(raw.prazo_dias, 1, 3650);
  if (!dataFim && dataInicio && prazoDias) dataFim = addDays(dataInicio, prazoDias);
  return {
    tipo: tipo && TIPOS_CONTRATO.includes(tipo) ? tipo : null,
    partes: {
      vendedor_proprietario: asString(partes.vendedor_proprietario),
      comprador_cliente: asString(partes.comprador_cliente),
      corretor: asString(partes.corretor),
    },
    imovel: { endereco: asString(imo.endereco), cidade: asString(imo.cidade, 120) },
    valor: asNumber(raw.valor, 1, 1_000_000_000),
    comissao_percentual: asNumber(raw.comissao_percentual, 0, 100),
    data_inicio: dataInicio,
    data_fim: dataFim,
    prazo_dias: prazoDias,
    observacoes: asString(raw.observacoes, 600),
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

    // Valida o token explicitamente (getUser() sem argumento não é confiável e
    // derrubava esta função com "Invalid session" — mesmo padrão da asaas-sync).
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Sua sessão expirou. Entre novamente para continuar." }, 401);
    }

    const { fileBase64, mimeType, modo } = await req.json();
    const isCentral = modo === "central";
    const prompt = isCentral ? CENTRAL_PROMPT : EXTRACTION_PROMPT;

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
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: fileBase64 } },
            ],
          }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1,
            // Extração determinística não precisa de "pensamento". O gemini-2.5-flash
            // liga o thinking por padrão, e os tokens de raciocínio consumiam o teto
            // de 1024 -> o JSON saía truncado/vazio -> parse falhava (erro 502).
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 8192,
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
    // Parse robusto: remove cercas de código e isola o trecho do 1º { ao último }
    // (tolera texto extra que o modelo às vezes coloca em volta do JSON).
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const jsonSlice = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonSlice);
    } catch {
      console.error("Gemini returned non-JSON:", cleaned.slice(0, 500));
      return jsonResponse({ error: "A IA não conseguiu estruturar os dados do contrato" }, 502);
    }

    return jsonResponse({ dados: isCentral ? sanitizeCentral(parsed) : sanitizeExtraction(parsed) });
  } catch (error) {
    console.error("analisar-contrato error:", error);
    return jsonResponse({ error: "Erro interno ao analisar contrato" }, 500);
  }
});
