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

/** DDDs que existem de verdade — 20, 25, 30, 50 e outros nunca foram atribuídos. */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Separa o telefone nos campos que o Asaas aceita.
 * Objeto vazio = não dá para enviar; quem chama simplesmente omite o telefone.
 */
export function telefoneParaAsaas(bruto: string | null | undefined): TelefoneAsaas {
  let d = (bruto ?? "").replace(/\D/g, "");

  // Código do país: lead-capture e integrações de WhatsApp gravam "55" na frente.
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);

  if (!DDDS_VALIDOS.has(Number(d.slice(0, 2)))) return {};

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
