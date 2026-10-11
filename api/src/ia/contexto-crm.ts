import { Prisma } from '@prisma/client';
import { diaBr, diaNoFuso, fimDoMes, FUSO_PADRAO, inicioDoMes } from './periodo';

type Tx = Prisma.TransactionClient;

/**
 * Resumo da conta que vai no prompt, dentro do run do usuário (RLS). Os números são os das telas:
 * "Contratos ativos" = status ATIVO (cartão da tela Aluguéis); "Receita do mês" = mês inteiro no fuso de quem
 * conversa, como os cartões da tela Financeiro (inclui lançamentos com data futura); negócios em aberto =
 * etapas abertas do Funil de Vendas. Clientes e imóveis contam tudo, como as telas, e dizem quantos são de
 * demonstração. É só orientação: perguntas de valor o modelo responde com consulta.
 */
export async function contextoCrm(tx: Tx, agora = new Date(), fuso = FUSO_PADRAO): Promise<string> {
  const hoje = diaNoFuso(agora, fuso);
  const de = inicioDoMes(hoje);
  const ate = fimDoMes(hoje);
  // maybeSingle(): com mais de uma linha visível o PostgREST dava erro e o texto saía N/A.
  const corretores = await tx.$queryRaw<Array<{ nome: string | null; creci: string | null; creci_estado: string | null }>>(Prisma.sql`
    select c.nome, c.creci, c.creci_estado::text as creci_estado from public.corretores c limit 2`);
  const corretor = corretores.length === 1 ? corretores[0] : null;
  const [n] = await tx.$queryRaw<Array<{
    clientes: number; clientes_demo: number; imoveis: number; imoveis_demo: number; contratos: number; alertas: number;
    receita: number; negocios: number;
  }>>(Prisma.sql`
    select
      (select count(*)::int from public.clientes) as clientes,
      (select count(*)::int from public.clientes where is_sample_data) as clientes_demo,
      (select count(*)::int from public.imoveis) as imoveis,
      (select count(*)::int from public.imoveis where is_sample_data) as imoveis_demo,
      (select count(*)::int from public.contratos where status = 'ATIVO') as contratos,
      (select count(*)::int from public.alertas where lido = false) as alertas,
      (select coalesce(sum(valor), 0)::float8 from public.lancamentos_financeiros
        where tipo = 'RECEITA' and corretor_id = public.get_corretor_id()
          and data >= (${de}::date)::timestamp at time zone 'UTC' and data < (${ate}::date + 1)::timestamp at time zone 'UTC') as receita,
      (select count(*)::int from public.crm_oportunidades o join public.crm_etapas e on e.id = o.etapa_id
        where e.ativo and e.tipo = 'ABERTA' and not o.is_sample_data) as negocios`);

  const demo = (q: number | undefined) => (q ? ` (${q} de demonstração)` : '');
  return `## Resumo da conta
- Corretor: ${corretor?.nome || 'N/A'} (CRECI ${corretor?.creci || 'N/A'}/${corretor?.creci_estado || 'N/A'})
- Total de clientes: ${n?.clientes || 0}${demo(n?.clientes_demo)}
- Total de imóveis: ${n?.imoveis || 0}${demo(n?.imoveis_demo)}
- Contratos ativos (tela Aluguéis): ${n?.contratos || 0}
- Alertas não lidos: ${n?.alertas || 0}
- Receita do mês: R$ ${(n?.receita ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (mês inteiro, ${diaBr(de)} a ${diaBr(ate)}, inclui lançamentos com data futura)
- Negócios em aberto no Funil de Vendas (sem os de demonstração): ${n?.negocios || 0}`;
}
