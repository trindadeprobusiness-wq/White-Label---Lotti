/** Atomic reservation before a paid operation; never trusts browser counters. */
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error: unknown }> };
export async function reserveContractQuota(client: RpcClient, owner: string) {
  const { data, error } = await client.rpc('reserve_contract_quota', { p_corretor: owner });
  if (error) throw new Error('QUOTA_UNAVAILABLE');
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; reservation_id?: string; used?: number; quota?: number } | null;
  return { allowed: row?.allowed === true && !!row.reservation_id, id: row?.reservation_id, used: row?.used ?? 0, limit: row?.quota ?? 0 };
}

export async function finishContractQuota(client: RpcClient, id: string, success: boolean) {
  const { error } = await client.rpc('finish_contract_quota', { p_id: id, p_success: success });
  if (error) throw new Error('QUOTA_FINALIZE_FAILED');
}
