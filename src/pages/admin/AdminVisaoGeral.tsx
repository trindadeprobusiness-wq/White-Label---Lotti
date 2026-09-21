import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, UserCheck, UserX, Handshake, MousePointerClick, Receipt } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { CartaoMetrica } from '@/components/admin/CartaoMetrica';
import { FiltroPeriodo } from '@/components/admin/FiltroPeriodo';
import { EstadoErro, SemDadosAinda } from '@/components/admin/Estados';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMetricas } from '@/hooks/admin/useAdminDados';
import { periodoDeAtalho, type AtalhoPeriodo, type Periodo } from '@/lib/admin/periodo';
import { moeda, numero, percentual } from '@/lib/formato';

const ROTULO_ASSINATURA: Record<string, string> = {
  trialing: 'Em teste',
  active: 'Ativas',
  past_due: 'Em atraso',
  canceled: 'Canceladas',
  expired: 'Expiradas',
  read_only: 'Somente leitura',
};

export default function AdminVisaoGeral() {
  const [atalho, setAtalho] = useState<AtalhoPeriodo | 'personalizado'>('30d');
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDeAtalho('30d'));

  const { data, isLoading, error, refetch } = useMetricas(periodo);

  const taxaConversao = useMemo(() => {
    if (!data) return null;
    const { atribuicoes, conversoes } = data.parceiros;
    if (!atribuicoes) return null;
    return (conversoes / atribuicoes) * 100;
  }, [data]);

  if (error) {
    return (
      <>
        <CabecalhoAdmin titulo="Visão geral" />
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      </>
    );
  }

  const u = data?.usuarios;
  const p = data?.parceiros;
  const c = data?.comissoes;

  return (
    <>
      <CabecalhoAdmin
        titulo="Visão geral"
        descricao="Como a operação da Lotti está no período escolhido."
      />

      <div className="mb-6">
        <FiltroPeriodo
          atalho={atalho}
          periodo={periodo}
          aoMudar={(a, p) => {
            setAtalho(a);
            setPeriodo(p);
          }}
        />
      </div>

      <section aria-labelledby="secao-usuarios" className="mb-8">
        <h2 id="secao-usuarios" className="mb-3 text-sm font-medium text-muted-foreground">
          Usuários
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CartaoMetrica
            titulo="Total de contas"
            valor={numero(u?.total ?? 0)}
            icone={<Users className="h-4 w-4" />}
            carregando={isLoading}
          />
          <CartaoMetrica
            titulo="Novos no período"
            valor={numero(u?.novos ?? 0)}
            atual={u?.novos}
            anterior={u?.novos_anterior}
            icone={<Users className="h-4 w-4" />}
            carregando={isLoading}
          />
          <CartaoMetrica
            titulo="Ativos"
            valor={numero(u?.ativos ?? 0)}
            icone={<UserCheck className="h-4 w-4" />}
            carregando={isLoading}
            ajuda={`Conta ativa com acesso registrado nos últimos ${
              data?.janela_atividade_dias ?? 30
            } dias. A janela é configurável em Configurações.`}
            detalhe={
              u && u.sem_dados > 0
                ? `${numero(u.sem_dados)} sem dados de atividade ainda`
                : undefined
            }
          />
          <CartaoMetrica
            titulo="Suspensos"
            valor={numero(u?.suspensos ?? 0)}
            icone={<UserX className="h-4 w-4" />}
            crescerEhRuim
            carregando={isLoading}
            ajuda="Contas suspensas perdem acesso a todos os dados enquanto a suspensão durar."
          />
        </div>

        {/* Sem dados de atividade é categoria própria, não "inativo". O registro
            só começou com o back office, e ninguém tem histórico anterior. */}
        {u && u.sem_dados > 0 && !isLoading && (
          <p className="mt-3 text-xs text-muted-foreground">
            {numero(u.sem_dados)} conta(s) ainda não têm acesso registrado. Elas não são
            contadas como inativas — o registro de atividade começou com o back office.
          </p>
        )}
      </section>

      <section aria-labelledby="secao-financeiro" className="mb-8">
        <h2 id="secao-financeiro" className="mb-3 text-sm font-medium text-muted-foreground">
          Receita e assinaturas
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Nada de "R$ 0,00" quando nunca houve receita: zero é uma afirmação
              sobre o negócio, ausência de dado não é. */}
          {isLoading ? (
            <CartaoMetrica titulo="Receita no período" valor="" carregando />
          ) : data?.receita.tem_dados ? (
            <CartaoMetrica
              titulo="Receita no período"
              valor={moeda(data.receita.recebida, true)}
              atual={data.receita.recebida}
              anterior={data.receita.recebida_anterior}
              icone={<Receipt className="h-4 w-4" />}
              detalhe={`${numero(data.receita.eventos)} evento(s) confirmado(s)`}
            />
          ) : (
            <SemDadosAinda
              titulo="Receita no período"
              explicacao="Nenhum evento financeiro confirmado foi registrado até agora. A cobrança de assinatura ainda não está ligada; lançamentos manuais aparecem aqui assim que forem feitos."
            />
          )}

          <Card className="sm:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Assinaturas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data?.assinaturas ?? {}).map(([chave, valor]) => (
                    <Badge key={chave} variant="outline" className="gap-1.5">
                      <span className="text-muted-foreground">
                        {ROTULO_ASSINATURA[chave] ?? chave}
                      </span>
                      <span className="font-semibold tabular-nums">{numero(valor)}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="secao-parceiros" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="secao-parceiros" className="text-sm font-medium text-muted-foreground">
            Parceiros
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/parceiros">Ver todos</Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CartaoMetrica
            titulo="Parceiros ativos"
            valor={numero(p?.ativos ?? 0)}
            detalhe={p ? `${numero(p.total)} no total` : undefined}
            icone={<Handshake className="h-4 w-4" />}
            carregando={isLoading}
          />
          <CartaoMetrica
            titulo="Cliques no período"
            valor={numero(p?.cliques ?? 0)}
            atual={p?.cliques}
            anterior={p?.cliques_anterior}
            icone={<MousePointerClick className="h-4 w-4" />}
            carregando={isLoading}
          />
          <CartaoMetrica
            titulo="Cadastros originados"
            valor={numero(p?.conversoes ?? 0)}
            atual={p?.conversoes}
            anterior={p?.conversoes_anterior}
            carregando={isLoading}
            ajuda="Contas criadas por quem chegou pelo link de um parceiro, dentro da janela de atribuição."
          />
          <CartaoMetrica
            titulo="Taxa de conversão"
            valor={taxaConversao === null ? '—' : percentual(taxaConversao)}
            carregando={isLoading}
            ajuda="Cadastros originados ÷ visitantes atribuídos no período. Fica em branco enquanto não houver visitante atribuído."
          />
        </div>
      </section>

      <section aria-labelledby="secao-comissoes">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="secao-comissoes" className="text-sm font-medium text-muted-foreground">
            Comissões
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/comissoes">Ver todas</Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CartaoMetrica
            titulo="Pendentes"
            valor={moeda(c?.valor_pendente ?? 0, true)}
            carregando={isLoading}
            ajuda="Geradas por receita confirmada, ainda sem aprovação."
          />
          <CartaoMetrica
            titulo="Aprovadas"
            valor={moeda(c?.valor_aprovada ?? 0, true)}
            carregando={isLoading}
            ajuda="Conferidas e prontas para pagamento."
          />
          <CartaoMetrica
            titulo="Pagas"
            valor={moeda(c?.valor_paga ?? 0, true)}
            carregando={isLoading}
          />
          <CartaoMetrica
            titulo="Estornadas"
            valor={moeda(c?.valor_estornada ?? 0, true)}
            crescerEhRuim
            carregando={isLoading}
            ajuda="Comissões desfeitas por estorno ou cancelamento da receita de origem."
          />
        </div>
      </section>
    </>
  );
}
