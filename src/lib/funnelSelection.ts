type FunnelClientStage = {
  id: string;
  status_funil: string;
};

export function getCommonSelectedStageId(
  selectedIds: ReadonlySet<string>,
  clients: readonly FunnelClientStage[],
  overrides: Readonly<Record<string, string>>,
): string | undefined {
  if (selectedIds.size === 0) return undefined;

  const clientsById = new Map(clients.map((client) => [client.id, client]));
  let commonStageId: string | undefined;

  for (const clientId of selectedIds) {
    const client = clientsById.get(clientId);
    if (!client) return undefined;

    const stageId = overrides[clientId] ?? client.status_funil;
    if (commonStageId === undefined) {
      commonStageId = stageId;
    } else if (commonStageId !== stageId) {
      return undefined;
    }
  }

  return commonStageId;
}
