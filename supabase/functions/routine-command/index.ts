import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requestGeminiChat } from "../_shared/ai/provider.ts";
import { adminClient, requireRoutineUser, routineCorsHeaders, routineJson, safeErrorCode } from "../_shared/routine/google.ts";

const ACTIVITIES = [
  "prospeccao", "primeiro_atendimento", "follow_up", "qualificacao_lead", "ligacao",
  "reuniao", "visita_imovel", "captacao_imovel", "avaliacao", "producao_midias",
  "publicacao_anuncio", "envio_proposta", "negociacao", "separacao_documentos",
  "analise_juridica", "assinatura_contrato", "vistoria", "entrega_chaves", "cobranca",
  "pagamento", "renovacao_contratual", "manutencao", "reuniao_interna",
  "tarefa_administrativa", "compromisso_pessoal", "outro",
];

function parseJsonContent(content: unknown): Record<string, unknown> {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

function cleanText(value: unknown, max = 180): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text || null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function findCandidate<T extends { id: string; label: string }>(query: string | null, candidates: T[]): T | null {
  if (!query) return null;
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const wanted = normalize(query);
  return candidates.find((candidate) => normalize(candidate.label) === wanted)
    || candidates.find((candidate) => normalize(candidate.label).includes(wanted) || wanted.includes(normalize(candidate.label)))
    || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: routineCorsHeaders });
  if (req.method !== "POST") return routineJson({ error: "Method not allowed" }, 405);
  try {
    const { user, membership } = await requireRoutineUser(req);
    const body = await req.json().catch(() => ({}));
    const command = cleanText(body.command, 2000);
    const timezone = cleanText(body.timezone, 80) || "America/Sao_Paulo";
    if (!command) return routineJson({ error: "Escreva o que deseja organizar." }, 400);
    const admin = adminClient();
    const { data: organization } = await admin.from("routine_organizations")
      .select("legacy_corretor_id").eq("id", membership.organization_id).single();
    if (!organization) return routineJson({ error: "Organização não encontrada." }, 403);

    const [{ data: clientRows }, { data: propertyRows }] = await Promise.all([
      admin.from("clientes").select("id, nome").eq("corretor_id", organization.legacy_corretor_id).limit(120),
      admin.from("imoveis").select("id, titulo, bairro, cidade, endereco").eq("corretor_id", organization.legacy_corretor_id).eq("ativo", true).limit(120),
    ]);
    const clients = (clientRows || []).map((item) => ({ id: item.id, label: item.nome }));
    const properties = (propertyRows || []).map((item) => ({
      id: item.id,
      label: item.titulo,
      context: [item.bairro, item.cidade].filter(Boolean).join(" · "),
      location: item.endereco || null,
    }));
    const now = new Date();
    const prompt = [
      "Você transforma um comando em uma PROPOSTA de atividade para um CRM imobiliário brasileiro.",
      "Nunca execute ação e nunca invente cliente, imóvel, data ou horário.",
      `Agora em UTC: ${now.toISOString()}. Zona do usuário: ${timezone}.`,
      `Categorias aceitas: ${ACTIVITIES.join(", ")}.`,
      "Retorne somente JSON com: kind(event|task), title, activity_type, start_at, end_at, due_at, client_query, property_query, location, reminder_minutes, priority(low|medium|high|urgent), missing_fields.",
      "Para event, start_at e end_at devem ser ISO 8601 com offset e duração sugerida. Para task use due_at.",
      "Se data ou horário indispensável não existir, use null e inclua o nome em missing_fields.",
      `Clientes disponíveis (id não deve sair no texto): ${clients.map((item) => item.label).join(" | ") || "nenhum"}.`,
      `Imóveis disponíveis: ${properties.map((item) => `${item.label}${item.context ? ` (${item.context})` : ""}`).join(" | ") || "nenhum"}.`,
      `Comando: ${command}`,
    ].join("\n");
    const response = await requestGeminiChat({
      messages: [
        { role: "system", content: "Você é o interpretador seguro da Central de Rotina da Lotti." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }, { timeoutMs: 30_000, retries: 1 });
    if (!response.ok) throw new Error(`provider_${response.status}`);
    const payload = await response.json();
    const raw = parseJsonContent(payload.choices?.[0]?.message?.content);
    const kind = raw.kind === "event" ? "event" : "task";
    const activityType = typeof raw.activity_type === "string" && ACTIVITIES.includes(raw.activity_type)
      ? raw.activity_type
      : "outro";
    const clientQuery = cleanText(raw.client_query);
    const propertyQuery = cleanText(raw.property_query);
    const client = findCandidate(clientQuery, clients);
    const property = findCandidate(propertyQuery, properties);
    const startAt = isoOrNull(raw.start_at);
    const endAt = isoOrNull(raw.end_at);
    const dueAt = isoOrNull(raw.due_at);
    const missing = Array.isArray(raw.missing_fields)
      ? raw.missing_fields.filter((item): item is string => typeof item === "string").slice(0, 5)
      : [];
    if (kind === "event" && !startAt && !missing.includes("data")) missing.push("data");
    if (kind === "event" && !endAt && !missing.includes("horário")) missing.push("horário");
    if (kind === "event" && startAt && endAt && new Date(endAt) <= new Date(startAt)) {
      throw new Error("invalid_interval");
    }
    const reminder = Number(raw.reminder_minutes);
    const priority = ["low", "medium", "high", "urgent"].includes(String(raw.priority))
      ? String(raw.priority)
      : "medium";
    return routineJson({
      proposal: {
        kind,
        title: cleanText(raw.title) || (kind === "event" ? "Novo compromisso" : "Nova tarefa"),
        activity_type: activityType,
        start_at: startAt,
        end_at: endAt,
        due_at: dueAt,
        client_query: clientQuery,
        client_id: client?.id || null,
        property_query: propertyQuery,
        property_id: property?.id || null,
        location: cleanText(raw.location, 500) || property?.location || null,
        assigned_to: user.id,
        reminder_minutes: Number.isFinite(reminder) && reminder >= 0 && reminder <= 525600 ? reminder : null,
        priority,
        missing_fields: [...new Set(missing)],
        requires_confirmation: true,
        conflicts: [],
        interpretation_source: "ai",
      },
    });
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 500;
    console.error("routine-command:", safeErrorCode(error));
    return routineJson({ error: status === 500 ? "Não consegui interpretar agora." : "Sua sessão não autoriza esta ação." }, status);
  }
});
