// Normalização de telefone brasileiro para os campos do Asaas.
//
// A coluna clientes.telefone é TEXT NOT NULL sem CHECK e recebe dado de sete
// caminhos com convenções diferentes: máscara "(62) 99999-8888", texto solto
// extraído do contrato pela IA e dígitos com código de país ("5562999998888",
// o padrão do lead-capture). O Asaas valida `mobilePhone` com rigor e devolve
// HTTP 400 ("O celular informado é inválido"), o que derrubava a emissão inteira
// antes de criar o pagamento — mesmo o telefone sendo opcional para ele.

export interface TelefoneAsaas {
  mobilePhone?: string;
  phone?: string;
}

/**
 * Separa o telefone nos campos que o Asaas aceita.
 * Objeto vazio = não dá para enviar; quem chama simplesmente omite o telefone.
 */
export function telefoneParaAsaas(bruto: string | null | undefined): TelefoneAsaas {
  let d = (bruto ?? "").replace(/\D/g, "");

  // Código do país: lead-capture e integrações de WhatsApp gravam "55" na frente.
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);

  // DDD válido no Brasil vai de 11 a 99.
  const ddd = Number(d.slice(0, 2));
  if (!(ddd >= 11 && ddd <= 99)) return {};

  // Celular: DDD + 9 dígitos, o primeiro deles sendo 9.
  if (d.length === 11 && d[2] === "9") return { mobilePhone: d };

  // Fixo (ou celular no formato antigo de 8 dígitos): o campo `phone` do Asaas
  // é bem menos exigente, então o contato não se perde.
  if (d.length === 10) return { phone: d };

  return {};
}

/**
 * true quando o Asaas recusou a requisição por causa do telefone.
 * O `code` vem em inglês (invalid_mobilePhone) e a `description` em português
 * ("O celular informado é inválido") — olhamos os dois.
 */
export function ehErroDeTelefone(body: unknown): boolean {
  const erros = (body as { errors?: { code?: string; description?: string }[] } | null)?.errors;
  if (!Array.isArray(erros) || erros.length === 0) return false;
  // Só é "erro de telefone" se TODOS forem — se houver outro problema junto
  // (CPF, nome), reenviar sem telefone não resolveria e mascararia a causa.
  return erros.every((e) => {
    const txt = `${e?.code ?? ""} ${e?.description ?? ""}`
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return txt.includes("phone") || txt.includes("celular") || txt.includes("telefone");
  });
}
