export interface DependenciasExclusaoCobranca {
  consultar: (path: string) => Promise<unknown>;
  excluir: (path: string) => Promise<unknown>;
}

function statusDoErro(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  return Number((error as { status?: unknown }).status);
}

export async function excluirCobrancaNoAsaas(
  externalId: string,
  deps: DependenciasExclusaoCobranca,
): Promise<void> {
  const path = `/payments/${externalId}`;
  let atual: { status?: unknown; deleted?: unknown } | null;
  try {
    atual = await deps.consultar(path) as { status?: unknown; deleted?: unknown } | null;
  } catch (error) {
    if (statusDoErro(error) === 404) return;
    throw error;
  }
  const status = String(atual?.status ?? "");

  if (atual?.deleted === true || status === "DELETED") return;

  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(status)) {
    throw new Error("A cobrança já está paga/confirmada no Asaas e não pode ser excluída.");
  }

  let removida: { deleted?: unknown } | null;
  try {
    removida = await deps.excluir(path) as { deleted?: unknown } | null;
  } catch (error) {
    if (statusDoErro(error) === 404) return;
    throw error;
  }
  if (removida?.deleted !== true) {
    throw new Error("O Asaas não confirmou a exclusão da cobrança.");
  }
}
