import type { ValidatedActionProposal } from "../_shared/ai/actions.ts";

// Só o que as ações usam do cliente service_role do Supabase. Fica fora do
// index.ts (que importa por URL do Deno) para ser testado no Vitest.
// deno-lint-ignore no-explicit-any
type Consulta = any;
export type AdminClient = {
  from: (table: string) => Consulta;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: Consulta; error: unknown }>;
};

function canalContato(tipo: unknown): "WHATSAPP" | "EMAIL" | "TELEFONE" | "PRESENCIAL" | "OUTRO" {
  const map: Record<string, "WHATSAPP" | "EMAIL" | "TELEFONE" | "PRESENCIAL" | "OUTRO"> = {
    LIGACAO: "TELEFONE",
    EMAIL: "EMAIL",
    WHATSAPP: "WHATSAPP",
    VISITA: "PRESENCIAL",
    PROPOSTA: "OUTRO",
    NOTA: "OUTRO",
  };
  return map[String(tipo).toUpperCase()] ?? "OUTRO";
}

export async function executeAction(
  admin: AdminClient,
  corretorId: string,
  proposal: ValidatedActionProposal,
): Promise<{ record_id?: string; existing?: boolean }> {
  const ensureClient = async (clientId: unknown) => {
    const { data, error } = await admin.from("clientes").select("id")
      .eq("id", clientId).eq("corretor_id", corretorId).maybeSingle();
    if (error || !data) throw new Error("client_not_authorized");
  };

  switch (proposal.action_type) {
    case "create_client": {
      const p = proposal.params;
      // Mesmo caminho do WhatsApp, da captura e do CRM: o telefone é procurado
      // em qualquer grafia sob a trava da conta, e quem já é cliente não ganha
      // um segundo cadastro. A resposta diz que ele já existia.
      const { data, error } = await admin.rpc("lotti_find_or_create_cliente", {
        p_owner: corretorId,
        p_phone: p.telefone || "",
        p_name: p.nome,
        p_dados: { tipo_interesse: p.tipo_interesse || "COMPRA" },
      });
      const resultado = data as { cliente_id?: string; created?: boolean } | null;
      if (error || !resultado?.cliente_id) throw new Error("create_client_failed");
      return resultado.created ? { record_id: resultado.cliente_id } : { record_id: resultado.cliente_id, existing: true };
    }
    case "update_client_status": {
      const p = proposal.params;
      const { data, error } = await admin.from("clientes").update({ status_funil: p.status })
        .eq("id", p.client_id).eq("corretor_id", corretorId).select("id").maybeSingle();
      if (error || !data) throw new Error("client_not_authorized");
      return { record_id: data.id };
    }
    case "schedule_followup": {
      const p = proposal.params;
      const { data, error } = await admin.from("clientes").update({ proximo_followup: p.date })
        .eq("id", p.client_id).eq("corretor_id", corretorId).select("id").maybeSingle();
      if (error || !data) throw new Error("client_not_authorized");
      return { record_id: data.id };
    }
    case "create_alert": {
      const p = proposal.params;
      const { data, error } = await admin.from("alertas").insert({
        mensagem: p.mensagem,
        tipo: p.tipo || "GERAL",
        prioridade: p.prioridade || "MEDIA",
        corretor_id: corretorId,
      }).select("id").single();
      if (error) throw new Error("create_alert_failed");
      return { record_id: data.id };
    }
    case "register_contact": {
      const p = proposal.params;
      await ensureClient(p.client_id);
      const { data, error } = await admin.from("historico_contatos").insert({
        cliente_id: p.client_id,
        tipo: canalContato(p.tipo),
        direcao: "OUT",
        conteudo: p.descricao,
        data_contato: new Date().toISOString(),
        metadata: { tipo_ui: String(p.tipo).toUpperCase(), origem: "lotti_ai" },
      }).select("id").single();
      if (error) throw new Error("register_contact_failed");
      return { record_id: data.id };
    }
    case "create_property": {
      const p = proposal.params;
      const { data, error } = await admin.from("imoveis").insert({
        titulo: p.titulo,
        tipo: p.tipo || "APARTAMENTO",
        valor: p.valor || 0,
        area_m2: p.area_m2 || 0,
        dormitorios: p.dormitorios || 0,
        garagem: p.garagem || 0,
        endereco: p.endereco || "",
        bairro: p.bairro || "",
        cidade: p.cidade || "",
        proprietario_nome: p.proprietario_nome || "",
        corretor_id: corretorId,
      }).select("id").single();
      if (error) throw new Error("create_property_failed");
      return { record_id: data.id };
    }
    case "create_financial_entry": {
      const p = proposal.params;
      const { data, error } = await admin.from("lancamentos_financeiros").insert({
        tipo: p.tipo,
        categoria: p.categoria,
        descricao: p.descricao,
        valor: p.valor,
        data: p.data || new Date().toISOString().slice(0, 10),
        recorrente: p.recorrente ?? false,
        corretor_id: corretorId,
      }).select("id").single();
      if (error) throw new Error("create_financial_entry_failed");
      return { record_id: data.id };
    }
  }
}
