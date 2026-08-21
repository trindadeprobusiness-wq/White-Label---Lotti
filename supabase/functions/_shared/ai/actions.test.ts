import { describe, expect, it } from "vitest";
import { validateActionProposal } from "./actions";

describe("validateActionProposal", () => {
  it("aceita uma proposta financeira estruturada", () => {
    const result = validateActionProposal({
      action_type: "create_financial_entry",
      params: { tipo: "DESPESA", categoria: "OUTROS", descricao: "Taxa", valor: 25.5 },
      description: "Lançar despesa de R$ 25,50",
    });
    expect(result.action_type).toBe("create_financial_entry");
  });

  it("rejeita UUID inválido e campos extras do modelo", () => {
    expect(() => validateActionProposal({
      action_type: "update_client_status",
      params: { client_id: "outro-tenant", status: "FECHADO_GANHO", bypass: true },
      description: "Mover lead",
    })).toThrow();
  });

  it("rejeita valor financeiro não positivo", () => {
    expect(() => validateActionProposal({
      action_type: "create_financial_entry",
      params: { tipo: "DESPESA", categoria: "OUTROS", descricao: "Teste", valor: -1 },
      description: "Lançar despesa",
    })).toThrow();
  });
});
