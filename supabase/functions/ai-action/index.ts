import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateActionProposal } from "../_shared/ai/actions.ts";
import { executeAction } from "./execute.ts";

type LooseSupabaseClient = ReturnType<typeof createClient<any>>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let claimedProposalId: string | null = null;
  let admin: LooseSupabaseClient | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) return json({ error: "Sua sessão expirou." }, 401);

    const { data: corretorId, error: corretorError } = await userClient.rpc("get_corretor_id");
    if (corretorError || !corretorId) return json({ error: "Corretor não encontrado." }, 403);

    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json();
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    const decision = body.decision;
    if (!/^[0-9a-f-]{36}$/i.test(proposalId) || !["confirm", "reject"].includes(decision)) {
      return json({ error: "Solicitação inválida." }, 400);
    }

    const { data: current, error: loadError } = await admin.from("ai_action_proposals")
      .select("*")
      .eq("id", proposalId)
      .eq("corretor_id", corretorId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (loadError || !current) return json({ error: "Proposta não encontrada." }, 404);

    if (decision === "reject") {
      if (current.status !== "pending") return json({ error: "A proposta já foi processada." }, 409);
      const { error } = await admin.from("ai_action_proposals").update({
        status: "rejected",
        updated_at: new Date().toISOString(),
      }).eq("id", proposalId).eq("status", "pending");
      if (error) return json({ error: "Não foi possível recusar a proposta." }, 500);
      return json({ status: "rejected", proposal_id: proposalId });
    }

    if (current.status === "executed") {
      return json({ status: "executed", proposal_id: proposalId, idempotent: true });
    }
    if (current.status !== "pending" || new Date(current.expires_at) <= new Date()) {
      return json({ error: "A proposta expirou ou já foi processada." }, 409);
    }

    const { data: claimed, error: claimError } = await admin.from("ai_action_proposals").update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).eq("status", "pending").gt("expires_at", new Date().toISOString())
      .select("*").maybeSingle();
    if (claimError || !claimed) return json({ error: "A proposta já foi processada." }, 409);
    claimedProposalId = proposalId;

    const proposal = validateActionProposal(claimed.payload as Record<string, unknown>);
    const result = await executeAction(admin, corretorId as string, proposal);

    await admin.from("ai_action_proposals").update({
      status: "executed",
      executed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).eq("status", "confirmed");

    return json({ status: "executed", proposal_id: proposalId, ...result });
  } catch (error) {
    console.error("ai-action failed:", error instanceof Error ? error.message : "unknown");
    if (admin && claimedProposalId) {
      await admin.from("ai_action_proposals").update({
        status: "failed",
        error_code: "execution_failed",
        updated_at: new Date().toISOString(),
      }).eq("id", claimedProposalId).eq("status", "confirmed");
    }
    return json({ error: "A ação não foi executada. Revise os dados e tente novamente." }, 500);
  }
});
