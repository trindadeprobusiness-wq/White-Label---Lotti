import { describe, expect, it } from "vitest";
import { excluirCobrancaNoAsaas } from "./excluir-cobranca";

describe("excluirCobrancaNoAsaas", () => {
  it("propaga a falha do Asaas para a fatura não ser cancelada apenas no banco", async () => {
    const falhaExterna = new Error("Asaas indisponível");

    await expect(excluirCobrancaNoAsaas("pay_123", {
      consultar: async () => ({ id: "pay_123", status: "PENDING" }),
      excluir: async () => {
        throw falhaExterna;
      },
    })).rejects.toBe(falhaExterna);
  });

  it("não exclui cobrança que o Asaas já informa como paga", async () => {
    let exclusoes = 0;

    await expect(excluirCobrancaNoAsaas("pay_pago", {
      consultar: async () => ({ id: "pay_pago", status: "RECEIVED" }),
      excluir: async () => {
        exclusoes += 1;
        return { deleted: true, id: "pay_pago" };
      },
    })).rejects.toThrow("já está paga");

    expect(exclusoes).toBe(0);
  });

  it("exige a confirmação deleted=true antes de permitir o cancelamento local", async () => {
    await expect(excluirCobrancaNoAsaas("pay_sem_confirmacao", {
      consultar: async () => ({ id: "pay_sem_confirmacao", status: "PENDING" }),
      excluir: async () => ({ deleted: false, id: "pay_sem_confirmacao" }),
    })).rejects.toThrow("não confirmou a exclusão");
  });

  it("trata como concluída a cobrança que já não existe no Asaas", async () => {
    const ausente = Object.assign(new Error("não encontrada"), { status: 404 });
    let exclusoes = 0;

    await expect(excluirCobrancaNoAsaas("pay_ausente", {
      consultar: async () => {
        throw ausente;
      },
      excluir: async () => {
        exclusoes += 1;
        return { deleted: true, id: "pay_ausente" };
      },
    })).resolves.toBeUndefined();

    expect(exclusoes).toBe(0);
  });

  it("permanece idempotente se a cobrança some entre a consulta e a exclusão", async () => {
    const ausente = Object.assign(new Error("não encontrada"), { status: 404 });

    await expect(excluirCobrancaNoAsaas("pay_corrida", {
      consultar: async () => ({ id: "pay_corrida", status: "PENDING" }),
      excluir: async () => {
        throw ausente;
      },
    })).resolves.toBeUndefined();
  });

  it.each([
    { id: "pay_removida_flag", status: "PENDING", deleted: true },
    { id: "pay_removida_status", status: "DELETED" },
  ])("reconhece cobrança já removida na resposta da consulta: $id", async (atual) => {
    await expect(excluirCobrancaNoAsaas(atual.id, {
      consultar: async () => atual,
      excluir: async () => {
        throw new Error("não deveria excluir novamente");
      },
    })).resolves.toBeUndefined();
  });
});
