import { Prisma } from '@prisma/client';
import type { PropostaValidada } from './acoes';
import { diaNoFuso, FUSO_PADRAO } from './periodo';

type Tx = Prisma.TransactionClient;

export interface ResultadoAcao {
  record_id?: string;
  existing?: boolean;
}

/** Mesmo mapa de supabase/functions/ai-action/execute.ts (tipo da tela → canal_contato). */
export function canalContato(tipo: unknown): 'WHATSAPP' | 'EMAIL' | 'TELEFONE' | 'PRESENCIAL' | 'OUTRO' {
  const mapa: Record<string, 'WHATSAPP' | 'EMAIL' | 'TELEFONE' | 'PRESENCIAL' | 'OUTRO'> = {
    LIGACAO: 'TELEFONE',
    EMAIL: 'EMAIL',
    WHATSAPP: 'WHATSAPP',
    VISITA: 'PRESENCIAL',
    PROPOSTA: 'OUTRO',
    NOTA: 'OUTRO',
  };
  return mapa[String(tipo).toUpperCase()] ?? 'OUTRO';
}

/** Erro de execução: o service responde o 500 genérico da função e marca a proposta como failed. */
export class AcaoNaoExecutada extends Error {
  constructor(codigo: string) {
    super(codigo);
    this.name = 'AcaoNaoExecutada';
  }
}

const id = (r: Array<{ id: string }>, codigo: string): string => {
  if (!r[0]?.id) throw new AcaoNaoExecutada(codigo);
  return r[0].id;
};

/**
 * Porte de executeAction, DENTRO do TenantDb (claims do usuário): o RLS de cada tabela vale como nas
 * telas, e o corretor_id continua explícito nos filtros e inserts, como a função fazia com o
 * service_role. create_client usa crm_criar_cliente (o mesmo lotti_find_or_create_cliente sob a trava
 * da conta, aberto ao papel authenticated).
 */
export async function executarAcao(tx: Tx, corretorId: string, proposta: PropostaValidada): Promise<ResultadoAcao> {
  const p = proposta.params as Record<string, unknown>;
  const clienteDaConta = async (clienteId: unknown) => {
    const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id::text as id from public.clientes where id = ${String(clienteId)}::uuid and corretor_id = ${corretorId}::uuid`);
    id(r, 'client_not_authorized');
  };

  switch (proposta.action_type) {
    case 'create_client': {
      const dados = { nome: p.nome, telefone: p.telefone || '', tipo_interesse: p.tipo_interesse || 'COMPRA' };
      const [{ r }] = await tx.$queryRaw<Array<{ r: { status?: string; cliente_id?: string; candidatos?: Array<{ id?: string }> } }>>(
        Prisma.sql`select public.crm_criar_cliente(${JSON.stringify(dados)}::jsonb) as r`);
      if (r?.status === 'created' && r.cliente_id) return { record_id: r.cliente_id };
      // Telefone que já é cliente: não cria outro; a resposta diz que ele já existia.
      if (r?.status === 'duplicate') return { record_id: r.candidatos?.[0]?.id, existing: true };
      throw new AcaoNaoExecutada('create_client_failed');
    }
    case 'update_client_status': {
      const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update public.clientes set status_funil = ${String(p.status)}::public.status_funil
        where id = ${String(p.client_id)}::uuid and corretor_id = ${corretorId}::uuid returning id::text as id`);
      return { record_id: id(r, 'client_not_authorized') };
    }
    case 'schedule_followup': {
      // Meio-dia de Brasília: cai no mesmo dia em todos os fusos do Brasil (UTC-2 a UTC-5); a meia-noite virava
      // o dia anterior em Manaus ou Cuiabá. As telas só mostram o dia do follow-up.
      const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update public.clientes set proximo_followup = (${String(p.date)}::date + time '12:00') at time zone ${FUSO_PADRAO}::text
        where id = ${String(p.client_id)}::uuid and corretor_id = ${corretorId}::uuid returning id::text as id`);
      return { record_id: id(r, 'client_not_authorized') };
    }
    case 'create_alert': {
      // alertas não tem coluna prioridade (a função tentava gravar e sempre falhava): vai para metadata.
      const metadata = { prioridade: p.prioridade || 'MEDIA' };
      const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        insert into public.alertas (mensagem, tipo, corretor_id, metadata)
        values (${String(p.mensagem)}::text, ${String(p.tipo || 'GERAL')}::public.tipo_alerta, ${corretorId}::uuid,
          ${JSON.stringify(metadata)}::jsonb)
        returning id::text as id`);
      return { record_id: id(r, 'create_alert_failed') };
    }
    case 'register_contact': {
      await clienteDaConta(p.client_id);
      const metadata = { tipo_ui: String(p.tipo).toUpperCase(), origem: 'lotti_ai' };
      const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        insert into public.historico_contatos (cliente_id, tipo, direcao, conteudo, data_contato, metadata)
        values (${String(p.client_id)}::uuid, ${canalContato(p.tipo)}::public.canal_contato, 'OUT', ${String(p.descricao)}::text,
          now(), ${JSON.stringify(metadata)}::jsonb)
        returning id::text as id`);
      return { record_id: id(r, 'register_contact_failed') };
    }
    case 'create_property': {
      const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        insert into public.imoveis (titulo, tipo, valor, area_m2, dormitorios, garagem, endereco, bairro, cidade, proprietario_nome, corretor_id)
        values (${String(p.titulo)}::text, ${String(p.tipo || 'APARTAMENTO')}::public.tipo_imovel, ${Number(p.valor || 0)}::numeric,
          ${Number(p.area_m2 || 0)}::numeric, ${Number(p.dormitorios || 0)}::int, ${Number(p.garagem || 0)}::int,
          ${String(p.endereco || '')}::text, ${String(p.bairro || '')}::text, ${String(p.cidade || '')}::text,
          ${String(p.proprietario_nome || '')}::text, ${corretorId}::uuid)
        returning id::text as id`);
      return { record_id: id(r, 'create_property_failed') };
    }
    case 'create_financial_entry': {
      const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        insert into public.lancamentos_financeiros (tipo, categoria, descricao, valor, data, recorrente, corretor_id)
        values (${String(p.tipo)}::text, ${String(p.categoria)}::text, ${String(p.descricao)}::text, ${Number(p.valor)}::numeric,
          ${String(p.data || diaNoFuso(new Date(), FUSO_PADRAO))}::timestamptz, ${p.recorrente === true}::boolean, ${corretorId}::uuid)
        returning id::text as id`);
      return { record_id: id(r, 'create_financial_entry_failed') };
    }
  }
}
