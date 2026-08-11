import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Classifica o cômodo de cada foto do imóvel e reescreve a descrição do anúncio.
//
// A IA APENAS classifica — quem ordena é o frontend (src/lib/ordemFotos.ts), por
// uma ordem canônica de mercado. Pedir "devolva a ordem certa" é bem menos
// confiável que pedir "isto é uma cozinha", e deixa a regra de negócio fora do
// modelo, testável sem rede.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_FOTOS = 25;
const MAX_BASE64_POR_FOTO = 3_000_000; // ~2,2MB cada, já reduzidas no navegador

// Precisa bater com ORDEM_CANONICA de src/lib/ordemFotos.ts.
const CATEGORIAS = [
  "FACHADA", "SALA", "COZINHA", "AREA_SERVICO", "QUARTO",
  "BANHEIRO", "VARANDA", "AREA_EXTERNA", "GARAGEM", "VISTA", "OUTRO",
];

const PROMPT = `Você analisa fotos de um imóvel para montar um anúncio imobiliário no Brasil.

Recebe N imagens, na ordem em que foram enviadas (a primeira é o índice 0).

Retorne APENAS um objeto JSON, sem markdown e sem explicação:
{
  "fotos": [ { "indice": <número da imagem, começando em 0>, "categoria": "<uma das categorias>" } ],
  "descricao_sugerida": "<texto do anúncio, ou null>"
}

Categorias permitidas: ${CATEGORIAS.join(" | ")}

Regras:
- Devolva UM item por imagem recebida, com o "indice" correspondente. Não pule, não invente.
- FACHADA = vista externa do prédio ou da casa, portaria, entrada.
- AREA_EXTERNA = piscina, quintal, churrasqueira, jardim, área de lazer do condomínio.
- VISTA = foto tirada de dentro mostrando a paisagem lá fora.
- Não souber com segurança: use OUTRO. Nunca chute um cômodo.
- "descricao_sugerida": reescreva a descrição recebida em 2 a 4 frases, tom
  profissional de corretor, destacando o que aparece NAS FOTOS e os dados do
  imóvel informados. Português do Brasil.
- NUNCA invente característica que não esteja nas fotos nem nos dados (não cite
  metragem, número de quartos, mobília ou benfeitoria que você não viu).
- Sem preço, sem telefone, sem "entre em contato", sem emoji.
- Sem descrição original e sem material suficiente: devolva null.`;

function asString(v: unknown, max = 300): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface FotoClassificada { indice: number; categoria: string }

/** Uma entrada por foto enviada: o que a IA não classificou vira OUTRO. */
function sanitizar(raw: Record<string, unknown>, total: number) {
  const brutas = Array.isArray(raw.fotos) ? raw.fotos : [];
  const porIndice = new Map<number, string>();

  for (const item of brutas) {
    const o = (item ?? {}) as Record<string, unknown>;
    const indice = typeof o.indice === "number" ? o.indice : Number(o.indice);
    if (!Number.isInteger(indice) || indice < 0 || indice >= total) continue;
    const cat = asString(o.categoria, 20)?.toUpperCase() ?? "";
    porIndice.set(indice, CATEGORIAS.includes(cat) ? cat : "OUTRO");
  }

  const fotos: FotoClassificada[] = [];
  for (let i = 0; i < total; i++) {
    fotos.push({ indice: i, categoria: porIndice.get(i) ?? "OUTRO" });
  }

  return { fotos, descricao_sugerida: asString(raw.descricao_sugerida, 1200) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Só corretor logado — mesmo padrão das outras funções: valida o token
    // explicitamente, porque getUser() sem argumento não é confiável aqui.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json({ error: "Sua sessão expirou. Entre novamente para continuar." }, 401);
    }

    const { imagens, descricao_atual, dados_imovel } = await req.json();

    if (!Array.isArray(imagens) || imagens.length === 0) {
      return json({ error: "Envie ao menos uma foto." }, 400);
    }
    if (imagens.length > MAX_FOTOS) {
      return json({ error: `Máximo de ${MAX_FOTOS} fotos por análise.` }, 400);
    }
    if (imagens.some((b: unknown) => typeof b !== "string" || !b || b.length > MAX_BASE64_POR_FOTO)) {
      return json({ error: "Alguma foto está inválida ou grande demais." }, 400);
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return json({ error: "GEMINI_API_KEY não configurada" }, 500);

    const contexto = [
      asString(dados_imovel?.titulo, 200) && `Título: ${asString(dados_imovel.titulo, 200)}`,
      asString(dados_imovel?.tipo, 40) && `Tipo: ${asString(dados_imovel.tipo, 40)}`,
      asString(dados_imovel?.bairro, 120) && `Bairro: ${asString(dados_imovel.bairro, 120)}`,
      asString(dados_imovel?.cidade, 120) && `Cidade: ${asString(dados_imovel.cidade, 120)}`,
      asString(descricao_atual, 2000) && `Descrição atual: ${asString(descricao_atual, 2000)}`,
    ].filter(Boolean).join("\n");

    // Uma chamada só com todas as fotos: mais barato que uma por foto e o modelo
    // enxerga o conjunto, o que melhora a classificação (dois quartos parecidos,
    // sala x varanda, etc.).
    const partes: unknown[] = [{ text: contexto ? `${PROMPT}\n\nDados do imóvel:\n${contexto}` : PROMPT }];
    for (const b64 of imagens) {
      partes.push({ inline_data: { mime_type: "image/jpeg", data: b64 } });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: partes }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.2,
            // Classificação não precisa de "pensamento", e os tokens de raciocínio
            // comiam o teto de saída truncando o JSON (mesmo problema já visto na
            // analisar-contrato).
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 4096,
          },
        }),
      },
    );

    if (!response.ok) {
      console.error("Gemini falhou:", response.status, await response.text());
      return json({ error: "Falha ao analisar as fotos com a IA" }, 502);
    }

    const data = await response.json();
    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const limpo = texto.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const ini = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    const recorte = ini !== -1 && fim > ini ? limpo.slice(ini, fim + 1) : limpo;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(recorte);
    } catch {
      console.error("Gemini devolveu não-JSON:", limpo.slice(0, 500));
      return json({ error: "A IA não conseguiu estruturar a análise das fotos" }, 502);
    }

    return json(sanitizar(parsed, imagens.length));
  } catch (error) {
    console.error("analisar-fotos-imovel error:", error);
    return json({ error: "Erro interno ao analisar as fotos" }, 500);
  }
});
