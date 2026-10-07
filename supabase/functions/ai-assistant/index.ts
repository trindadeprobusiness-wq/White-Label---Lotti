import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MAX_AI_TOOL_ROUNDS,
  normalizeLottiAIRequest,
} from "../_shared/ai/contracts.ts";
import { validateActionProposal } from "../_shared/ai/actions.ts";
import { checarCota, registrarUso } from "../_shared/cotas.ts";
import {
  buildAssistantSystemPrompt,
  LOTTI_PROMPT_VERSIONS,
} from "../_shared/ai/prompt-registry.ts";
import {
  estimateTextUsage,
  fastAIModel,
  requestGeminiChat,
} from "../_shared/ai/provider.ts";
import {
  finishAIRun,
  recordAIToolCall,
  startAIRun,
} from "../_shared/ai/telemetry.ts";

type LooseSupabaseClient = ReturnType<typeof createClient<any>>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_MESSAGES_PER_MINUTE = 30;
const MAX_CONTEXT_MESSAGES = 20;
const ASSISTANT_QUOTA = "ai_assistant_monthly";

// --- Auth helpers ---

async function getAuthenticatedUser(req: Request, supabaseClient: LooseSupabaseClient) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw { status: 401, message: "Missing authorization" };

  const { data: { user }, error } = await supabaseClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, '').trim());
  if (error || !user) throw { status: 401, message: "Invalid session" };
  return user;
}

async function getCorretorId(supabaseClient: LooseSupabaseClient): Promise<string> {
  const { data, error } = await supabaseClient.rpc("get_corretor_id");
  if (error || !data) throw { status: 403, message: "Corretor not found" };
  return data as string;
}

// --- Rate limiting ---

async function checkRateLimitLegacy(supabaseAdmin: LooseSupabaseClient, corretorId: string) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 60_000);

  const { data } = await supabaseAdmin
    .from("ai_rate_limits")
    .select("message_count, window_start")
    .eq("corretor_id", corretorId)
    .maybeSingle();

  if (!data) {
    await supabaseAdmin.from("ai_rate_limits").upsert({
      corretor_id: corretorId,
      message_count: 1,
      window_start: now.toISOString(),
    });
    return;
  }

  const dbWindowStart = new Date(data.window_start);
  if (dbWindowStart < windowStart) {
    await supabaseAdmin
      .from("ai_rate_limits")
      .update({ message_count: 1, window_start: now.toISOString() })
      .eq("corretor_id", corretorId);
    return;
  }

  if (data.message_count >= MAX_MESSAGES_PER_MINUTE) {
    throw { status: 429, message: "Rate limit exceeded. Try again in a minute." };
  }

  await supabaseAdmin
    .from("ai_rate_limits")
    .update({ message_count: data.message_count + 1 })
    .eq("corretor_id", corretorId);
}

async function checkRateLimit(supabaseAdmin: LooseSupabaseClient, corretorId: string) {
  const { data, error } = await supabaseAdmin.rpc("consumir_rate_limit_ia", {
    _corretor_id: corretorId,
    _limite: MAX_MESSAGES_PER_MINUTE,
  });

  // Compatibilidade temporária: a Edge Function pode chegar antes da migration.
  if (error) {
    console.warn("Atomic AI rate limit unavailable; using legacy limiter:", error.code ?? "unknown");
    return checkRateLimitLegacy(supabaseAdmin, corretorId);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.permitido) {
    throw { status: 429, message: "Limite de mensagens excedido. Tente novamente em um minuto." };
  }
}

async function checkPlanQuota(supabaseAdmin: LooseSupabaseClient, corretorId: string) {
  const quota = await checarCota(supabaseAdmin, corretorId, ASSISTANT_QUOTA);
  if (!quota.permitido) {
    const message = quota.habilitado && quota.limite !== null
      ? `Você atingiu o limite de ${quota.limite} interações de IA deste mês.`
      : "Seu plano atual não inclui o Assistente Lotti.";
    throw { status: 402, message };
  }
}

// --- CRM Context ---

async function loadCRMContext(supabaseClient: LooseSupabaseClient) {
  const [corretorRes, clientesRes, imoveisRes, contratosRes, alertasRes, financeiroRes] =
    await Promise.all([
      supabaseClient.from("corretores").select("nome, creci, creci_estado").maybeSingle(),
      supabaseClient.from("clientes").select("id", { count: "exact", head: true }),
      supabaseClient.from("imoveis").select("id", { count: "exact", head: true }),
      supabaseClient.from("contratos").select("id", { count: "exact", head: true }).eq("status", "FINALIZADO"),
      supabaseClient.from("alertas").select("id", { count: "exact", head: true }).eq("lido", false),
      supabaseClient.from("lancamentos_financeiros")
        .select("valor, tipo")
        .gte("data", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0]),
    ]);

  const receita = (financeiroRes.data || [])
    .filter((l: { tipo: string }) => l.tipo === "RECEITA")
    .reduce((sum: number, l: { valor: number }) => sum + l.valor, 0);

  const corretor = corretorRes.data;

  return `## Contexto do Usuário
- Corretor: ${corretor?.nome || "N/A"} (CRECI ${corretor?.creci || "N/A"}/${corretor?.creci_estado || "N/A"})
- Total de clientes: ${clientesRes.count || 0}
- Total de imóveis: ${imoveisRes.count || 0}
- Contratos ativos: ${contratosRes.count || 0}
- Alertas pendentes: ${alertasRes.count || 0}
- Receita do mês: R$ ${receita.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

// --- Tool Definitions ---

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_clients",
      description: "Buscar clientes no CRM por nome, status do funil ou tipo de interesse",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca (nome, email, telefone)" },
          status_funil: {
            type: "string",
            enum: ["QUALIFICACAO", "VISITA_PROPOSTA", "DOCUMENTACAO", "FECHADO_GANHO", "FECHADO_PERDIDO"],
          },
          tipo_interesse: { type: "string", enum: ["COMPRA", "LOCACAO", "AMBOS"] },
          limit: { type: "number", description: "Máximo de resultados (padrão 10)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_client_details",
      description: "Obter detalhes completos de um cliente específico, incluindo histórico de contatos",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID do cliente" },
        },
        required: ["client_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_properties",
      description: "Buscar imóveis por tipo, cidade, faixa de preço",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca (título, endereço)" },
          tipo: { type: "string", enum: ["APARTAMENTO", "CASA", "COMERCIAL", "TERRENO"] },
          cidade: { type: "string" },
          preco_min: { type: "number" },
          preco_max: { type: "number" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_property_details",
      description: "Obter detalhes completos de um imóvel específico",
      parameters: {
        type: "object",
        properties: {
          property_id: { type: "string", description: "UUID do imóvel" },
        },
        required: ["property_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_financial_summary",
      description: "Obter resumo financeiro (receitas e despesas) por período",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["month", "quarter", "year"],
            description: "Período (padrão: month)",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_financial_entries",
      description: "Listar lançamentos financeiros com filtros",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["RECEITA", "DESPESA"] },
          categoria: { type: "string" },
          date_from: { type: "string", description: "Data início (YYYY-MM-DD)" },
          date_to: { type: "string", description: "Data fim (YYYY-MM-DD)" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_contracts",
      description: "Listar contratos com filtros",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["RASCUNHO", "FINALIZADO"] },
          tipo: { type: "string" },
          client_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_alerts",
      description: "Obter alertas pendentes",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["FOLLOWUP", "DOCUMENTO", "EXCLUSIVIDADE", "GERAL"] },
          prioridade: { type: "string", enum: ["ALTA", "MEDIA", "BAIXA"] },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_funnel_stats",
      description: "Obter estatísticas do funil de vendas",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_contact_history",
      description: "Obter histórico de contatos de um cliente",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID do cliente" },
        },
        required: ["client_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "suggest_action",
      description:
        "Propor uma ação de escrita para o usuário CONFIRMAR antes de executar. NUNCA execute direto. " +
        "Use quando o usuário pedir para criar/cadastrar/lançar algo — inclusive quando ele enviar um " +
        "documento (o texto do arquivo aparece em 'Contexto de Arquivo Enviado') e pedir para colocá-lo " +
        "em uma aba da plataforma. Extraia os dados do documento e preencha 'params'.\n\n" +
        "Formato de params por action_type:\n" +
        "- create_client: { nome, telefone, tipo_interesse? ('COMPRA'|'LOCACAO'|'AMBOS') }\n" +
        "- update_client_status: { client_id, status ('QUALIFICACAO'|'VISITA_PROPOSTA'|'DOCUMENTACAO'|'FECHADO_GANHO'|'FECHADO_PERDIDO') }\n" +
        "- schedule_followup: { client_id, date (YYYY-MM-DD) }\n" +
        "- create_alert: { mensagem, tipo? ('FOLLOWUP'|'DOCUMENTO'|'EXCLUSIVIDADE'|'GERAL'), prioridade? ('ALTA'|'MEDIA'|'BAIXA') }\n" +
        "- register_contact: { client_id, tipo, descricao }\n" +
        "- create_property (aba Imóveis): { titulo, tipo ('APARTAMENTO'|'CASA'|'COMERCIAL'|'TERRENO'), valor (número), " +
        "area_m2?, dormitorios?, garagem?, endereco, bairro, cidade, proprietario_nome? }\n" +
        "- create_financial_entry (aba Financeiro): { tipo ('RECEITA'|'DESPESA'), categoria (um dos códigos válidos), " +
        "descricao, valor (número), data? (YYYY-MM-DD, padrão hoje), recorrente? (boolean) }\n\n" +
        "Categorias financeiras válidas — DESPESA: ANUNCIO_PORTAL, ANUNCIO_SOCIAL, ANUNCIO_TRADICIONAL, " +
        "OPERACIONAL_ESCRITORIO, OPERACIONAL_TRANSPORTE, OPERACIONAL_SISTEMA, IMPOSTO_ISS, IMPOSTO_IR, " +
        "TAXA_BANCARIA, COMISSAO_PARCEIRO, OUTROS. RECEITA: COMISSAO_VENDA, COMISSAO_LOCACAO, " +
        "TAXA_INTERMEDIACAO, HONORARIO_AVALIACAO, CONSULTORIA, OUTROS. Escolha a mais próxima; se incerto, use OUTROS.",
      parameters: {
        type: "object",
        properties: {
          action_type: {
            type: "string",
            enum: [
              "create_client",
              "update_client_status",
              "schedule_followup",
              "create_alert",
              "register_contact",
              "create_property",
              "create_financial_entry",
            ],
          },
          params: {
            type: "object",
            description: "Parâmetros da ação (schema depende do action_type — veja a descrição da tool)",
          },
          description: {
            type: "string",
            description:
              "Resumo legível do que será feito, citando os dados-chave extraídos (ex.: 'Cadastrar imóvel " +
              "\"Apto Centro\", R$ 320.000, 2 dorms, Rua X, Anápolis'). Mostrado ao usuário para confirmação.",
          },
        },
        required: ["action_type", "params", "description"],
      },
    },
  },
];

// --- Tool Execution ---

interface ToolExecutionContext {
  supabaseAdmin: LooseSupabaseClient;
  runId: string | null;
  corretorId: string;
  userId: string;
  entityRefs: Array<{ type: string; id: string }>;
}

function textArg(args: Record<string, unknown>, key: string, maxLength = 160): string {
  return typeof args[key] === "string" ? args[key].trim().slice(0, maxLength) : "";
}

function uuidArg(args: Record<string, unknown>, key: string): string | null {
  const value = textArg(args, key, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function boundedLimit(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), maximum) : fallback;
}

function safePostgrestSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 120).replace(/[,%()]/g, " ");
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  supabaseClient: LooseSupabaseClient,
  context: ToolExecutionContext,
): Promise<string> {
  switch (name) {
    case "search_clients": {
      const search = safePostgrestSearch(args.query);
      let query = supabaseClient
        .from("clientes")
        .select("id, nome, telefone, email, status_funil, tipo_interesse, ultimo_contato, proximo_followup")
        .order("created_at", { ascending: false })
        .limit(boundedLimit(args.limit, 10, 25));
      if (search) query = query.or(`nome.ilike.%${search}%,email.ilike.%${search}%,telefone.ilike.%${search}%`);
      if (args.status_funil) query = query.eq("status_funil", args.status_funil);
      if (args.tipo_interesse) query = query.eq("tipo_interesse", args.tipo_interesse);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data || []);
    }

    case "get_client_details": {
      const clientId = uuidArg(args, "client_id");
      if (!clientId) return JSON.stringify({ error: "invalid_client_id" });
      const { data: client } = await supabaseClient
        .from("clientes")
        .select("*")
        .eq("id", clientId)
        .maybeSingle();
      const { data: history } = await supabaseClient
        .from("historico_contatos")
        .select("*")
        .eq("cliente_id", clientId)
        .order("data", { ascending: false })
        .limit(10);
      return JSON.stringify({ client, history: history || [] });
    }

    case "search_properties": {
      const search = safePostgrestSearch(args.query);
      let query = supabaseClient
        .from("imoveis")
        .select("id, titulo, tipo, valor, area_m2, dormitorios, garagem, endereco, bairro, cidade")
        .order("created_at", { ascending: false })
        .limit(boundedLimit(args.limit, 10, 25));
      if (search) query = query.or(`titulo.ilike.%${search}%,endereco.ilike.%${search}%`);
      if (args.tipo) query = query.eq("tipo", args.tipo);
      if (args.cidade) query = query.ilike("cidade", `%${args.cidade}%`);
      if (args.preco_min) query = query.gte("valor", args.preco_min);
      if (args.preco_max) query = query.lte("valor", args.preco_max);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data || []);
    }

    case "get_property_details": {
      const propertyId = uuidArg(args, "property_id");
      if (!propertyId) return JSON.stringify({ error: "invalid_property_id" });
      const { data: property } = await supabaseClient
        .from("imoveis")
        .select("*")
        .eq("id", propertyId)
        .maybeSingle();
      const { data: photos } = await supabaseClient
        .from("imovel_fotos")
        .select("arquivo_url, principal, ordem")
        .eq("imovel_id", propertyId)
        .order("ordem");
      return JSON.stringify({ property, photos: photos || [] });
    }

    case "get_financial_summary": {
      const period = (args.period as string) || "month";
      const now = new Date();
      let dateFrom: string;
      if (period === "year") {
        dateFrom = `${now.getFullYear()}-01-01`;
      } else if (period === "quarter") {
        const qMonth = Math.floor(now.getMonth() / 3) * 3;
        dateFrom = `${now.getFullYear()}-${String(qMonth + 1).padStart(2, "0")}-01`;
      } else {
        dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      }
      const { data } = await supabaseClient
        .from("lancamentos_financeiros")
        .select("valor, tipo, categoria, data, descricao")
        .gte("data", dateFrom)
        .order("data", { ascending: false });
      const entries = data || [];
      const receita = entries.filter((e: { tipo: string }) => e.tipo === "RECEITA").reduce((s: number, e: { valor: number }) => s + e.valor, 0);
      const despesa = entries.filter((e: { tipo: string }) => e.tipo === "DESPESA").reduce((s: number, e: { valor: number }) => s + e.valor, 0);
      return JSON.stringify({ period, receita, despesa, saldo: receita - despesa, total_lancamentos: entries.length });
    }

    case "get_financial_entries": {
      let query = supabaseClient
        .from("lancamentos_financeiros")
        .select("*")
        .order("data", { ascending: false })
        .limit((args.limit as number) || 20);
      if (args.tipo) query = query.eq("tipo", args.tipo);
      if (args.categoria) query = query.eq("categoria", args.categoria);
      if (args.date_from) query = query.gte("data", args.date_from);
      if (args.date_to) query = query.lte("data", args.date_to);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data || []);
    }

    case "get_contracts": {
      let query = supabaseClient
        .from("contratos")
        .select("id, tipo, cliente_id, imovel_id, valor, data_inicio, prazo_meses, status, created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (args.status) query = query.eq("status", args.status);
      if (args.tipo) query = query.eq("tipo", args.tipo);
      if (args.client_id) query = query.eq("cliente_id", args.client_id);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data || []);
    }

    case "get_alerts": {
      let query = supabaseClient
        .from("alertas")
        .select("*")
        .eq("lido", false)
        .order("created_at", { ascending: false })
        .limit(20);
      if (args.tipo) query = query.eq("tipo", args.tipo);
      if (args.prioridade) query = query.eq("prioridade", args.prioridade);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data || []);
    }

    case "get_funnel_stats": {
      const { data } = await supabaseClient.from("clientes").select("status_funil");
      const clients = data || [];
      const stats: Record<string, number> = {};
      for (const c of clients) {
        stats[(c as { status_funil: string }).status_funil] = (stats[(c as { status_funil: string }).status_funil] || 0) + 1;
      }
      return JSON.stringify({ total: clients.length, by_status: stats });
    }

    case "get_contact_history": {
      const clientId = uuidArg(args, "client_id");
      if (!clientId) return JSON.stringify({ error: "invalid_client_id" });
      const { data, error } = await supabaseClient
        .from("historico_contatos")
        .select("*")
        .eq("cliente_id", clientId)
        .order("data", { ascending: false })
        .limit(20);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data || []);
    }

    case "suggest_action": {
      let proposal;
      try {
        proposal = validateActionProposal(args);
      } catch {
        return JSON.stringify({
          error: "invalid_action_schema",
          message: "A proposta não passou na validação e não pode ser executada.",
        });
      }
      const proposalId = crypto.randomUUID();
      const { error } = await context.supabaseAdmin.from("ai_action_proposals").insert({
        id: proposalId,
        run_id: context.runId,
        corretor_id: context.corretorId,
        user_id: context.userId,
        action_type: proposal.action_type,
        entity_refs: context.entityRefs,
        preview: {
          action_type: proposal.action_type,
          description: proposal.description,
          fields: Object.keys(proposal.params),
        },
        payload: proposal,
        idempotency_key: crypto.randomUUID(),
      });
      if (error) {
        console.warn("AI action proposal persistence failed:", error.code ?? "unknown");
        return JSON.stringify({
          error: "action_persistence_unavailable",
          message: "A ação não pôde ser preparada com segurança. Tente novamente.",
        });
      }

      return JSON.stringify({
        type: "action",
        action: {
          id: proposalId,
          action_type: proposal.action_type,
          params: proposal.params,
          description: proposal.description,
          status: "pending",
        },
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// --- Main handler ---

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw { status: 401, message: "Missing authorization" };

    const supabaseClient = createClient<any>(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const supabaseAdmin = createClient<any>(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const user = await getAuthenticatedUser(req, supabaseClient);
    const corretorId = await getCorretorId(supabaseClient);
    await checkRateLimit(supabaseAdmin, corretorId);
    await checkPlanQuota(supabaseAdmin, corretorId);

    const body = await req.json();
    const aiRequest = normalizeLottiAIRequest(body, {
      organizationId: corretorId,
      userId: user.id,
    });
    const conversation_id = typeof body.conversation_id === "string" ? body.conversation_id : null;
    const file_context = typeof body.file_context === "string" ? body.file_context : undefined;
    const runStartedAt = Date.now();
    const runId = await startAIRun(supabaseAdmin, {
      traceId: aiRequest.traceId,
      organizationId: aiRequest.organizationId,
      userId: aiRequest.userId,
      module: aiRequest.module,
      intent: aiRequest.intent,
      model: fastAIModel(),
      promptVersion: LOTTI_PROMPT_VERSIONS.assistant,
      outputMode: aiRequest.outputMode,
      inputChars: aiRequest.message.length + (file_context?.length ?? 0),
      confirmationRequired: aiRequest.requiresConfirmation,
      metadata: { entity_count: aiRequest.entityRefs.length },
    });

    // Create or load conversation
    let convId = conversation_id;
    if (!convId) {
      const { data: conv, error } = await supabaseClient
        .from("ai_conversations")
        .insert({ corretor_id: corretorId, model: fastAIModel() })
        .select("id")
        .single();
      if (error) throw { status: 500, message: "Failed to create conversation" };
      convId = conv.id;
    }

    // Persist user message
    await supabaseClient.from("ai_messages").insert({
      conversation_id: convId,
      role: "user",
      content: aiRequest.message,
      metadata: {
        trace_id: aiRequest.traceId,
        module: aiRequest.module,
        intent: aiRequest.intent,
        entity_refs: aiRequest.entityRefs,
        output_mode: aiRequest.outputMode,
      },
    });

    // Load conversation history
    const { data: historyRows } = await supabaseClient
      .from("ai_messages")
      .select("role, content, tool_calls, tool_name")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTEXT_MESSAGES);

    const crmContext = await loadCRMContext(supabaseClient);
    const systemPrompt = buildAssistantSystemPrompt({
      module: aiRequest.module,
      crmContext,
      fileContext: file_context,
    });

    const messages: Array<{ role: string; content: string; tool_calls?: unknown; tool_call_id?: string }> = [
      { role: "system", content: systemPrompt },
    ];

    for (const row of [...(historyRows || [])].reverse()) {
      if (row.role === "tool" && row.tool_name) {
        messages.push({ role: "tool", content: row.content, tool_call_id: row.tool_name });
      } else if (row.role === "assistant" && row.tool_calls) {
        messages.push({ role: "assistant", content: row.content || "", tool_calls: row.tool_calls });
      } else {
        messages.push({ role: row.role, content: row.content });
      }
    }

    // --- Streaming response with tool loop ---
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let continueLoop = true;
          let failed = false;
          let toolRound = 0;
          let outputChars = 0;
          let providerInputChars = 0;
          const currentMessages = [...messages];
          const currentUsage = () => estimateTextUsage(providerInputChars, outputChars);

          while (continueLoop) {
            toolRound += 1;
            if (toolRound > MAX_AI_TOOL_ROUNDS) {
              failed = true;
              await finishAIRun(supabaseAdmin, runId, {
                status: "blocked",
                outputChars,
                ...currentUsage(),
                latencyMs: Date.now() - runStartedAt,
                errorCode: "tool_round_limit",
              });
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: "error",
                error: "A solicitação exigiu ações demais. Reformule o pedido em uma etapa por vez.",
              })}\n\n`));
              break;
            }

            providerInputChars += JSON.stringify({ messages: currentMessages, tools: TOOLS }).length;
            const aiResponse = await requestGeminiChat({
              messages: currentMessages,
              tools: TOOLS,
              stream: true,
            }, { timeoutMs: 60_000 });

            if (!aiResponse.ok) {
              console.error("AI provider error status:", aiResponse.status, "trace:", aiRequest.traceId);
              failed = true;
              await finishAIRun(supabaseAdmin, runId, {
                status: "failed",
                outputChars,
                ...currentUsage(),
                latencyMs: Date.now() - runStartedAt,
                errorCode: `provider_${aiResponse.status}`,
              });
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "error", error: "Erro ao comunicar com IA" })}\n\n`),
              );
              break;
            }

            const reader = aiResponse.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let fullContent = "";
            let toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = [];
            let hasToolCalls = false;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]") continue;

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta;

                  if (delta?.content) {
                    fullContent += delta.content;
                    outputChars += delta.content.length;
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "text", content: delta.content })}\n\n`),
                    );
                  }

                  if (delta?.tool_calls) {
                    hasToolCalls = true;
                    for (const tc of delta.tool_calls) {
                      // OpenAI/xAI fragmentam a chamada em chunks com 'index'; o endpoint
                      // OpenAI-compat do Gemini envia cada chamada completa e sem 'index' —
                      // nesse caso cada entrada é uma chamada nova.
                      const idx = typeof tc.index === "number" ? tc.index : toolCalls.length;
                      if (!toolCalls[idx]) {
                        toolCalls[idx] = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
                      }
                      if (tc.id) toolCalls[idx].id = tc.id;
                      if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                      if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
                    }
                  }
                } catch {
                  // Skip malformed SSE chunks
                }
              }
            }

            if (hasToolCalls && toolCalls.length > 0) {
              // Persist assistant message with tool calls
              await supabaseClient.from("ai_messages").insert({
                conversation_id: convId,
                role: "assistant",
                content: fullContent,
                tool_calls: toolCalls,
              });

              currentMessages.push({
                role: "assistant",
                content: fullContent,
                tool_calls: toolCalls,
              });

              // Execute each tool call
              for (const tc of toolCalls) {
                let toolArgs: Record<string, unknown> = {};
                try {
                  toolArgs = JSON.parse(tc.function.arguments);
                } catch {
                  toolArgs = {};
                }

                const toolStartedAt = Date.now();
                const result = await executeTool(tc.function.name, toolArgs, supabaseClient, {
                  supabaseAdmin,
                  runId,
                  corretorId,
                  userId: user.id,
                  entityRefs: aiRequest.entityRefs,
                });
                await recordAIToolCall(supabaseAdmin, runId, {
                  toolName: tc.function.name,
                  toolKind: tc.function.name === "suggest_action" ? "proposal" : "read",
                  status: result.includes('"error"') ? "failed" : "completed",
                  durationMs: Date.now() - toolStartedAt,
                  entityRefs: aiRequest.entityRefs,
                });

                // Check if it's a suggest_action — send to frontend
                if (tc.function.name === "suggest_action") {
                  try {
                    const parsed = JSON.parse(result);
                    if (parsed.type === "action") {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: "action", action: parsed.action })}\n\n`),
                      );
                    }
                  } catch { /* ignore */ }
                }

                // Persist tool response
                await supabaseClient.from("ai_messages").insert({
                  conversation_id: convId,
                  role: "tool",
                  content: result,
                  tool_name: tc.id,
                });

                currentMessages.push({
                  role: "tool",
                  content: result,
                  tool_call_id: tc.id,
                });
              }

              // Reset for next iteration
              toolCalls = [];
              hasToolCalls = false;
            } else {
              // No tool calls — final response
              continueLoop = false;

              // Persist final assistant message
              await supabaseClient.from("ai_messages").insert({
                conversation_id: convId,
                role: "assistant",
                content: fullContent,
              });

              // Update conversation title on first exchange
              if (!conversation_id) {
                const title = fullContent.slice(0, 80).replace(/[#*_]/g, "").trim() || "Nova conversa";
                await supabaseClient
                  .from("ai_conversations")
                  .update({ title, updated_at: new Date().toISOString() })
                  .eq("id", convId);
              } else {
                await supabaseClient
                  .from("ai_conversations")
                  .update({ updated_at: new Date().toISOString() })
                  .eq("id", convId);
              }
            }
          }

          if (!failed) {
            await registrarUso(supabaseAdmin, corretorId, ASSISTANT_QUOTA);
            await finishAIRun(supabaseAdmin, runId, {
              status: "completed",
              outputChars,
              ...currentUsage(),
              latencyMs: Date.now() - runStartedAt,
            });
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                type: "done",
                conversation_id: convId,
                trace_id: aiRequest.traceId,
                prompt_version: LOTTI_PROMPT_VERSIONS.assistant,
              })}\n\n`),
            );
          }
          controller.close();
        } catch (err) {
          console.error("Stream error:", err);
          await finishAIRun(supabaseAdmin, runId, {
            status: "failed",
            latencyMs: Date.now() - runStartedAt,
            errorCode: "stream_error",
          });
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: "Internal error" })}\n\n`),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500;
    const message = (err as { message?: string }).message || "Internal error";
    console.error("ai-assistant error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
