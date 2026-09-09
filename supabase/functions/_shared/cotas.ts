/**
 * Cota de plano vista do servidor.
 *
 * Por que não dá para confiar no front: o lead entra por webhook do WhatsApp e
 * pela landing do QR Code. Em nenhum dos dois existe React para checar limite —
 * o `LimitGuard` protege botão, e aqui não há botão nenhum.
 *
 * A regra que este módulo existe para garantir: **cota nunca bloqueia a captura
 * do lead.** O contato é do corretor, não nosso. Barrar a gravação para forçar
 * um upgrade destrói o ativo dele, e ele nem descobre — o lead simplesmente
 * some. O que a cota decide é se a IA vai conversar com aquele lead.
 */

export interface ResultadoCota {
  permitido: boolean;
  usado: number;
  limite: number | null;
  ilimitado: boolean;
  habilitado: boolean;
}

const NEGADO: ResultadoCota = {
  permitido: false,
  usado: 0,
  limite: 0,
  ilimitado: false,
  habilitado: false,
};

type RpcResult = { data?: unknown; error: unknown };
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/**
 * Consulta a cota. Erro de banco devolve NEGADO — na dúvida, não gastamos
 * inferência; o lead segue gravado e o corretor atende à mão.
 */
export async function checarCota(
  supabase: RpcClient,
  corretorId: string,
  featureKey: string,
): Promise<ResultadoCota> {
  try {
    const { data, error } = await supabase.rpc('checar_cota', {
      _corretor_id: corretorId,
      _feature_key: featureKey,
    });

    if (error) {
      console.error(`checar_cota(${featureKey}) falhou`, error);
      return NEGADO;
    }

    const linha = Array.isArray(data) ? data[0] : data;
    if (!linha) return NEGADO;

    const r = linha as Record<string, unknown>;
    return {
      permitido: r.permitido === true,
      usado: Number(r.usado ?? 0),
      limite: r.limite === null || r.limite === undefined ? null : Number(r.limite),
      ilimitado: r.ilimitado === true,
      habilitado: r.habilitado === true,
    };
  } catch (e) {
    console.error(`checar_cota(${featureKey}) lançou`, e);
    return NEGADO;
  }
}

/**
 * Registra consumo. Nunca lança: contar é contabilidade, e falhar a
 * contabilidade não pode derrubar o atendimento que já aconteceu.
 */
export async function registrarUso(
  supabase: RpcClient,
  corretorId: string,
  featureKey: string,
  quantidade = 1,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('incrementar_uso', {
      _corretor_id: corretorId,
      _feature_key: featureKey,
      _quantidade: quantidade,
    });
    if (error) console.error(`incrementar_uso(${featureKey}) falhou`, error);
  } catch (e) {
    console.error(`incrementar_uso(${featureKey}) lançou`, e);
  }
}

/** Executa uma operação paga somente com cota e contabiliza após o sucesso. */
export async function consumirCota<T>(
  supabase: Parameters<typeof checarCota>[0] & Parameters<typeof registrarUso>[0],
  corretorId: string,
  featureKey: string,
  operacao?: () => Promise<T>,
): Promise<ResultadoCota & { resultado?: T }> {
  const cota = await checarCota(supabase, corretorId, featureKey);
  if (!cota.permitido || !operacao) return cota;

  const resultado = await operacao();
  await registrarUso(supabase, corretorId, featureKey);
  return { ...cota, resultado };
}

/** Chave da cota que dirige o custo do produto. */
export const COTA_LEADS = 'leads_qualificados_monthly';

/**
 * Decide se a IA conversa com este lead e já registra o consumo quando sim.
 *
 * Devolve também o texto do aviso quando a cota acabou, para quem chama gravar
 * um alerta — o corretor precisa saber que os leads estão chegando sem
 * atendimento automático, senão ele descobre pelo silêncio.
 */
export async function liberarQualificacao(
  supabase: Parameters<typeof checarCota>[0] & Parameters<typeof registrarUso>[0],
  corretorId: string,
): Promise<{ qualificar: boolean; aviso: string | null; cota: ResultadoCota }> {
  const cota = await checarCota(supabase, corretorId, COTA_LEADS);

  if (cota.permitido) {
    await registrarUso(supabase, corretorId, COTA_LEADS);
    return { qualificar: true, aviso: null, cota };
  }

  const aviso = cota.limite === 0 || !cota.habilitado
    ? 'Seu plano não inclui qualificação automática de leads. O contato foi salvo para você atender.'
    : `Sua cota de ${cota.limite} leads qualificados do mês acabou. Os contatos continuam sendo salvos, mas sem atendimento automático da IA.`;

  return { qualificar: false, aviso, cota };
}
