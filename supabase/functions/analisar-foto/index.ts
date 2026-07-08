import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
// A imagem é reduzida no cliente antes de enviar; este limite é uma salvaguarda.
const MAX_BASE64_LENGTH = 8_000_000; // ~6 MB

const AI_ANALYSIS_PROMPT = `You are a professional real estate photo editor AI. Analyze this property photo and return ONLY a JSON object (no markdown, no explanation) with optimal enhancement parameters to make it look like a professional real estate listing photo for Facebook Ads.

The JSON must have exactly these keys with numeric values:
{
  "brightness": <number between 0.85 and 1.25, where 1.0 = no change>,
  "contrast": <number between 0.90 and 1.35, where 1.0 = no change>,
  "saturation": <number between 0.90 and 1.30, where 1.0 = no change>,
  "warmth": <number between -15 and 15, positive = warmer/yellower, negative = cooler/bluer>,
  "shadows": <number between 0 and 40, amount to lift dark areas>,
  "highlights": <number between 0 and 30, amount to reduce blown highlights>,
  "sharpness": <number between 0 and 1, sharpening strength>
}

Rules:
- Improve illumination, contrast and colors naturally
- Make the photo more vibrant and attractive but still realistic
- Correct white balance naturally
- Enhance texture without changing real materials
- Return ONLY the JSON object, nothing else`;

interface EnhancementParams {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  shadows: number;
  highlights: number;
  sharpness: number;
}

const DEFAULT_PARAMS: EnhancementParams = {
  brightness: 1.08,
  contrast: 1.15,
  saturation: 1.10,
  warmth: 5,
  shadows: 15,
  highlights: 10,
  sharpness: 0.4,
};

function clampParams(parsed: Partial<EnhancementParams>): EnhancementParams {
  return {
    brightness: Math.min(1.30, Math.max(0.80, parsed.brightness ?? DEFAULT_PARAMS.brightness)),
    contrast: Math.min(1.40, Math.max(0.85, parsed.contrast ?? DEFAULT_PARAMS.contrast)),
    saturation: Math.min(1.35, Math.max(0.85, parsed.saturation ?? DEFAULT_PARAMS.saturation)),
    warmth: Math.min(20, Math.max(-20, parsed.warmth ?? DEFAULT_PARAMS.warmth)),
    shadows: Math.min(50, Math.max(0, parsed.shadows ?? DEFAULT_PARAMS.shadows)),
    highlights: Math.min(40, Math.max(0, parsed.highlights ?? DEFAULT_PARAMS.highlights)),
    sharpness: Math.min(1, Math.max(0, parsed.sharpness ?? DEFAULT_PARAMS.sharpness)),
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
    // 1. Autenticação: só corretores logados podem usar.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid session" }, 401);

    // 2. Validação de entrada.
    const { imageBase64, mimeType, userApiKey } = await req.json();

    if (typeof imageBase64 !== "string" || imageBase64.length === 0 || imageBase64.length > MAX_BASE64_LENGTH) {
      return jsonResponse({ error: "Imagem inválida ou muito grande" }, 400);
    }
    if (typeof mimeType !== "string" || !ALLOWED_MIME.includes(mimeType)) {
      return jsonResponse({ error: "Formato de imagem inválido" }, 400);
    }

    // 3. Resolução da chave: override do usuário (opcional) ou segredo do servidor.
    const geminiKey = (typeof userApiKey === "string" && userApiKey.trim())
      ? userApiKey.trim()
      : Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY não configurada" }, 500);
    }

    // 4. Análise com Gemini. Em qualquer falha, cai para os parâmetros padrão
    //    (a foto ainda é melhorada localmente — resiliência preservada).
    let params = DEFAULT_PARAMS;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: AI_ANALYSIS_PROMPT },
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
              ],
            }],
            generationConfig: {
              response_mime_type: "application/json",
              temperature: 0.2,
              maxOutputTokens: 256,
            },
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        params = clampParams(JSON.parse(cleaned) as Partial<EnhancementParams>);
      } else {
        const errText = await response.text();
        console.warn("Gemini analysis failed:", response.status, errText);
      }
    } catch (e) {
      console.warn("Gemini analysis error, using defaults:", e);
    }

    return jsonResponse({ params });
  } catch (error) {
    console.error("analisar-foto error:", error);
    // Resiliente: mesmo em erro inesperado, devolve padrões para não travar o fluxo.
    return jsonResponse({ params: DEFAULT_PARAMS });
  }
});
