import { Prisma } from '@prisma/client';

/**
 * Os pg_cron do Supabase que passam a rodar na API (bloco B5 da virada), como job schedulers do BullMQ.
 *
 * UM interruptor para os quatro: AGENDAMENTOS_ENABLED='true'. Desligado por padrão, para a cópia do
 * banco (ensaio) nunca gerar fatura nem alerta antes da virada. Na virada: desligar os pg_cron do
 * Supabase (cron.unschedule) e ligar esta variável no serviço da API — os dois juntos nunca.
 *
 * Fuso: o pg_cron do Supabase roda em UTC e as instruções usam now()/CURRENT_DATE da sessão, que lá é
 * UTC. Aqui o padrão é avaliado em UTC (tz 'UTC') e a instrução roda com TimeZone = 'UTC' local à
 * transação, então os instantes e as datas são os mesmos de antes, qualquer que seja o fuso do
 * servidor ou do banco. Ex.: gerar-faturas-mensais = dia 25 às 06:00 UTC (03:00 em São Paulo).
 *
 * O SQL é o texto das migrations, sem mudança (só o alias AS n nos SELECT, para ler o resultado):
 *   supabase/migrations/20260708150000_asaas_core_financeiro.sql:402, :406, :412
 *   supabase/migrations/20260729120000_central_contratos.sql:112
 */
export const VAR_AGENDAMENTOS = 'AGENDAMENTOS_ENABLED';
export const FILA_AGENDAMENTOS = 'agendamentos';
export const FUSO_AGENDAMENTOS = 'UTC';

export function agendamentosLigados(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[VAR_AGENDAMENTOS] === 'true';
}

export interface Agendamento {
  /** Nome do job no BullMQ, igual ao jobname do pg_cron. */
  nome: string;
  /** Id fixo do job scheduler: o mesmo a cada boot, então reiniciar não duplica o agendamento. */
  schedulerId: string;
  /** Expressão cron do pg_cron, avaliada em UTC. */
  padrao: string;
  /** 'valor': select que devolve um inteiro (linhas criadas); 'linhas': update (linhas afetadas). */
  modo: 'valor' | 'linhas';
  sql: Prisma.Sql;
  /**
   * Atraso máximo aceito entre o instante previsto e o início da execução. Um job que ficou parado na
   * fila (API desligada, interruptor desligado e religado meses depois) e passou disso é descartado em
   * vez de rodar fora de hora — o pg_cron também não recupera execução perdida.
   */
  toleranciaMs: number;
}

const HORA = 3_600_000;

export const AGENDAMENTOS: readonly Agendamento[] = [
  {
    // Dia 25, 06:00 UTC (03:00 BRT): gera a competência do mês seguinte.
    nome: 'gerar-faturas-mensais',
    schedulerId: 'agendamento-gerar-faturas-mensais',
    padrao: '0 6 25 * *',
    modo: 'valor',
    sql: Prisma.sql`SELECT public.generate_monthly_rent_bills((date_trunc('month', now()) + interval '1 month')::date) AS n`,
    toleranciaMs: 12 * HORA,
  },
  {
    // Todo dia, 07:00 UTC (04:00 BRT): status ATRASADO persistido no banco.
    nome: 'marcar-faturas-atrasadas',
    schedulerId: 'agendamento-marcar-faturas-atrasadas',
    padrao: '0 7 * * *',
    modo: 'linhas',
    sql: Prisma.sql`UPDATE public.faturas_aluguel
      SET status = 'ATRASADO'
      WHERE status = 'PENDENTE' AND data_vencimento < CURRENT_DATE`,
    toleranciaMs: 12 * HORA,
  },
  {
    // A cada 5 min: evento do webhook do Asaas preso em PROCESSING há mais de 10 min volta para nova tentativa.
    nome: 'sweeper-webhook-events',
    schedulerId: 'agendamento-sweeper-webhook-events',
    padrao: '*/5 * * * *',
    modo: 'linhas',
    sql: Prisma.sql`UPDATE public.asaas_webhook_events
      SET status = 'RECEIVED'
      WHERE status = 'PROCESSING' AND received_at < now() - interval '10 minutes'`,
    toleranciaMs: 10 * 60_000,
  },
  {
    // Todo dia, 08:00 UTC (05:00 BRT): alertas de vencimento de contratos de exclusividade/compra e venda.
    nome: 'gerar-alertas-vencimento',
    schedulerId: 'agendamento-gerar-alertas-vencimento',
    padrao: '0 8 * * *',
    modo: 'valor',
    sql: Prisma.sql`SELECT public.gerar_alertas_vencimento_contratos() AS n`,
    toleranciaMs: 12 * HORA,
  },
  {
    // A cada 15 min: diagnóstico parado há 24 h vira abandonado e o limite de taxa vencido é apagado.
    // Não veio de pg_cron (no Supabase dependia de chamar a Edge diagnostic-notifications de fora);
    // o e-mail continua só na rota /api/diagnostico/manutencao.
    nome: 'manutencao-diagnostico',
    schedulerId: 'agendamento-manutencao-diagnostico',
    padrao: '*/15 * * * *',
    modo: 'valor',
    sql: Prisma.sql`SELECT public.diagnostic_maintenance() AS n`,
    toleranciaMs: 30 * 60_000,
  },
];

export function agendamentoPorNome(nome: string): Agendamento | undefined {
  return AGENDAMENTOS.find((a) => a.nome === nome);
}
