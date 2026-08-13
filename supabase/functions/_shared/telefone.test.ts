import { describe, expect, it } from "vitest";
import { telefoneParaAsaas } from "./telefone";

describe("telefoneParaAsaas", () => {
  it("remove máscara e envia celular no campo correto", () => {
    expect(telefoneParaAsaas("(62) 99999-8888")).toEqual({ mobilePhone: "62999998888" });
  });

  it("remove o código do país gravado por integrações", () => {
    expect(telefoneParaAsaas("55 62 99999-8888")).toEqual({ mobilePhone: "62999998888" });
  });

  it("envia telefone fixo como phone, nunca como mobilePhone", () => {
    expect(telefoneParaAsaas("(62) 3333-4444")).toEqual({ phone: "6233334444" });
  });

  it.each([null, "", "não informado", "(20) 99999-8888", "629999888"])(
    "omite telefone ausente ou inválido: %s",
    (telefone) => {
      expect(telefoneParaAsaas(telefone)).toEqual({});
    },
  );
});
