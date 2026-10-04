import { useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Flag, ListChecks, Sparkles, UserPlus, UsersRound } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { CartaoMetrica } from '@/components/admin/CartaoMetrica';
import { FiltroPeriodo } from '@/components/admin/FiltroPeriodo';
import { EstadoErro } from '@/components/admin/Estados';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useMetricasOnboarding } from '@/hooks/admin/useAdminDados';
import { periodoDeAtalho, type AtalhoPeriodo, type Periodo } from '@/lib/admin/periodo';
import { numero, percentual } from '@/lib/formato';
import { ContasAtendimento } from '@/components/admin/ContasAtendimento';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const ROTULOS: Record<string, string> = {
  boas_vindas: 'Boas-vindas', persona: 'Tipo de operação', aceitar_convite: 'Aceite de convite',
  perfil: 'Perfil profissional', empresa: 'Empresa', objetivo: 'Objetivo principal',
  entrada_dados: 'Entrada de dados', primeiro_imovel: 'Primeiro imóvel',
  primeiro_cliente: 'Primeiro cliente', primeira_oportunidade: 'Primeira oportunidade',
  primeira_rotina: 'Primeira atividade', equipe: 'Equipe', conclusao: 'Conclusão',
};

export default function AdminOnboarding() {
  return <>
    <CabecalhoAdmin titulo="Atendimento" descricao="Contas da plataforma" />
    <Tabs defaultValue="contas">
      <TabsList className="mb-5"><TabsTrigger value="contas">Contas</TabsTrigger><TabsTrigger value="ativacao">Ativação</TabsTrigger></TabsList>
      <TabsContent value="contas"><ContasAtendimento /></TabsContent>
      <TabsContent value="ativacao"><Ativacao /></TabsContent>
    </Tabs>
  </>;
}

function Ativacao() {
  const [atalho, setAtalho] = useState<AtalhoPeriodo | 'personalizado'>('30d');
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDeAtalho('30d'));
  const { data, isLoading, error, refetch } = useMetricasOnboarding(periodo);

  const taxaConclusao = data?.iniciados ? (data.concluidos / data.iniciados) * 100 : null;
  const taxaPrimeiroValor = data?.iniciados ? (data.primeiro_valor / data.iniciados) * 100 : null;
  const etapas = useMemo(
    () => Object.entries(data?.por_etapa ?? {}).sort((a, b) => b[1] - a[1]),
    [data?.por_etapa],
  );
  const maiorEtapa = Math.max(1, ...etapas.map(([, total]) => total));

  if (error) {
    return <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />;
  }

  return (
    <>
      <div className="mb-6"><FiltroPeriodo atalho={atalho} periodo={periodo} aoMudar={(a, p) => { setAtalho(a); setPeriodo(p); }} /></div>

      <section aria-labelledby="metricas-ativacao" className="mb-7">
        <h2 id="metricas-ativacao" className="mb-3 text-sm font-medium text-muted-foreground">Ativação</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CartaoMetrica titulo="Novos cadastros" valor={numero(data?.novos_cadastros ?? 0)} icone={<UserPlus className="h-4 w-4" />} carregando={isLoading} />
          <CartaoMetrica titulo="Onboardings iniciados" valor={numero(data?.iniciados ?? 0)} icone={<ListChecks className="h-4 w-4" />} carregando={isLoading} />
          <CartaoMetrica titulo="Concluídos" valor={numero(data?.concluidos ?? 0)} detalhe={taxaConclusao === null ? 'Sem base no período' : `${percentual(taxaConclusao)} dos iniciados`} icone={<CheckCircle2 className="h-4 w-4" />} carregando={isLoading} />
          <CartaoMetrica titulo="Primeiro valor" valor={numero(data?.primeiro_valor ?? 0)} detalhe={taxaPrimeiroValor === null ? 'Sem base no período' : `${percentual(taxaPrimeiroValor)} dos iniciados`} icone={<Flag className="h-4 w-4" />} carregando={isLoading} />
          <CartaoMetrica titulo="Sem avanço no cadastro" valor={numero(data?.travados ?? 0)} detalhe="Etapa sem atualização há mais de 48 horas" crescerEhRuim icone={<Clock3 className="h-4 w-4" />} carregando={isLoading} />
          <CartaoMetrica titulo="Usaram demonstração" valor={numero(data?.usaram_demonstracao ?? 0)} icone={<Sparkles className="h-4 w-4" />} carregando={isLoading} />
          <CartaoMetrica titulo="Convites preparados" valor={numero(data?.convites ?? 0)} icone={<UsersRound className="h-4 w-4" />} carregando={isLoading} />
          <CartaoMetrica titulo="Trials encerrando" valor={numero(data?.trials_encerrando ?? 0)} detalhe="Próximos 7 dias" crescerEhRuim icone={<Clock3 className="h-4 w-4" />} carregando={isLoading} />
        </div>
      </section>

      <Card>
        <CardHeader><CardTitle className="text-base">Cadastros em andamento por etapa</CardTitle></CardHeader>
        <CardContent>
          {etapas.length === 0 && !isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum onboarding em andamento neste momento.</p>
          ) : (
            <div className="space-y-4">
              {etapas.map(([chave, total]) => (
                <div key={chave} className="grid items-center gap-2 sm:grid-cols-[190px_1fr_52px]">
                  <p className="text-sm font-medium">{ROTULOS[chave] ?? chave}</p>
                  <Progress value={(total / maiorEtapa) * 100} aria-label={`${total} contas em ${ROTULOS[chave] ?? chave}`} className="h-2" />
                  <p className="text-right text-sm tabular-nums text-muted-foreground">{numero(total)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
