import { Prisma } from '@prisma/client';
import { inicioDoPeriodo } from './ferramentas.service';

type Tx = Prisma.TransactionClient;

/**
 * loadCRMContext do ai-assistant, dentro do run do usuário (RLS). Contagens e receita saem do próprio
 * banco (a função somava no navegador até o teto de 1000 linhas do PostgREST). "Contratos ativos"
 * continua contando status FINALIZADO, como a função.
 */
export async function contextoCrm(tx: Tx, agora = new Date()): Promise<string> {
  // maybeSingle(): com mais de uma linha visível o PostgREST dava erro e o texto saía N/A.
  const corretores = await tx.$queryRaw<Array<{ nome: string | null; creci: string | null; creci_estado: string | null }>>(Prisma.sql`
    select c.nome, c.creci, c.creci_estado::text as creci_estado from public.corretores c limit 2`);
  const corretor = corretores.length === 1 ? corretores[0] : null;
  const [n] = await tx.$queryRaw<Array<{ clientes: number; imoveis: number; contratos: number; alertas: number; receita: number }>>(Prisma.sql`
    select
      (select count(*)::int from public.clientes) as clientes,
      (select count(*)::int from public.imoveis) as imoveis,
      (select count(*)::int from public.contratos where status = 'FINALIZADO') as contratos,
      (select count(*)::int from public.alertas where lido = false) as alertas,
      (select coalesce(sum(valor), 0)::float8 from public.lancamentos_financeiros
        where tipo = 'RECEITA' and data >= ${inicioDoPeriodo('month', agora)}::timestamptz) as receita`);

  return `## Contexto do Usuário
- Corretor: ${corretor?.nome || 'N/A'} (CRECI ${corretor?.creci || 'N/A'}/${corretor?.creci_estado || 'N/A'})
- Total de clientes: ${n?.clientes || 0}
- Total de imóveis: ${n?.imoveis || 0}
- Contratos ativos: ${n?.contratos || 0}
- Alertas pendentes: ${n?.alertas || 0}
- Receita do mês: R$ ${(n?.receita ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}
