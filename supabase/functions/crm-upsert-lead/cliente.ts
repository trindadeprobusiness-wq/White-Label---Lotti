// Só o que o upsert usa do cliente service_role do Supabase. Fica fora do
// index.ts (que importa por URL do Deno) para ser testado no Vitest.
// deno-lint-ignore no-explicit-any
type Consulta = any;
export type ServiceDb = {
  from: (table: string) => Consulta;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: Consulta; error: unknown }>;
};

export interface DadosLead {
  nome?: string;
  telefone: string;
  email?: string;
  tipo_interesse: string;
  status_funil: string;
  observacoes?: string;
  tracking: Record<string, unknown>;
}

/**
 * Grava o lead que o n8n qualificou, um cliente por telefone na conta.
 *
 * A busca era por telefone exato: "(62) 99111-0003" digitado no CRM e
 * "5562991110003" vindo do WhatsApp viravam dois clientes. Agora o cliente vem
 * de lotti_find_or_create_cliente (mesma chave e trava do WhatsApp, da captura
 * e do CRM). Quem já existe recebe a qualificação nova, como antes; o nome só é
 * trocado quando o n8n manda um, nunca pelo genérico "Lead WhatsApp".
 */
export async function salvarClienteDoLead(db: ServiceDb, corretorId: string, lead: DadosLead) {
  const agora = new Date().toISOString();
  const { data, error } = await db.rpc('lotti_find_or_create_cliente', {
    p_owner: corretorId,
    p_phone: lead.telefone,
    p_name: lead.nome ?? 'Lead WhatsApp',
    p_dados: {
      email: lead.email,
      tipo_interesse: lead.tipo_interesse,
      status_funil: lead.status_funil,
      observacoes: lead.observacoes,
      tracking_data: lead.tracking,
      ultimo_contato: agora,
    },
  });
  const resultado = data as { cliente_id?: string; created?: boolean } | null;
  if (error || !resultado?.cliente_id) throw error ?? new Error('Não foi possível salvar o cliente do lead.');
  if (resultado.created) return { cliente_id: resultado.cliente_id, created: true };

  const { data: atual } = await db.from('clientes').select('tracking_data').eq('id', resultado.cliente_id).maybeSingle();
  // Sem telefone no update: o número do cadastro é o que o corretor já usa.
  const { error: erroUpdate } = await db.from('clientes').update({
    ...(lead.nome ? { nome: lead.nome } : {}),
    email: lead.email,
    tipo_interesse: lead.tipo_interesse,
    status_funil: lead.status_funil,
    observacoes: lead.observacoes,
    ultimo_contato: agora,
    tracking_data: { ...(atual?.tracking_data ?? {}), ...lead.tracking },
  }).eq('id', resultado.cliente_id);
  if (erroUpdate) throw erroUpdate;
  return { cliente_id: resultado.cliente_id, created: false };
}
