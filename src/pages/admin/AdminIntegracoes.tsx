import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { EstadoErro } from '@/components/admin/Estados';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useStatusIntegracoes } from '@/hooks/admin/useSaasDados';
import { dataHoraBR, numero } from '@/lib/formato';
import { cn } from '@/lib/utils';

type Nivel = 'ok' | 'atencao' | 'erro' | 'neutro';

interface Sinal {
  titulo: string;
  nivel: Nivel;
  detalhe: string;
  acao?: string;
}

const ICONE: Record<Nivel, React.ReactNode> = {
  ok: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
  atencao: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
  erro: <XCircle className="h-4 w-4 text-destructive" />,
  neutro: <ShieldCheck className="h-4 w-4 text-muted-foreground" />,
};

function BlocoSinais({ titulo, sinais }: { titulo: string; sinais: Sinal[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sinais.map((s) => (
          <div key={s.titulo} className="flex gap-3">
            <div className="mt-0.5 flex-shrink-0">{ICONE[s.nivel]}</div>
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.titulo}</p>
              <p className="text-sm text-muted-foreground">{s.detalhe}</p>
              {/* Cada alerta diz o que fazer. "Erro" sem próximo passo obriga
                  quem lê a descobrir sozinho — e normalmente ninguém descobre. */}
              {s.acao && (
                <p className="mt-1 text-xs text-muted-foreground/80">{s.acao}</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function AdminIntegracoes() {
  const { data, isLoading, error, refetch, isFetching } = useStatusIntegracoes();

  if (error) {
    return (
      <>
        <CabecalhoAdmin titulo="Status das integrações" />
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <>
        <CabecalhoAdmin titulo="Status das integrações" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 py-6">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </>
    );
  }

  const checkout: Sinal[] = data.checkout.instalado
    ? [
        {
          titulo: 'Tabela de pedidos instalada',
          nivel: 'ok',
          detalhe: `${numero(data.checkout.pedidos)} pedido(s), ${numero(
            data.checkout.pagos,
          )} pago(s).`,
        },
        {
          titulo: 'Pedidos pagos sem acesso enviado',
          nivel: data.checkout.pagos_sem_acesso > 0 ? 'erro' : 'ok',
          detalhe:
            data.checkout.pagos_sem_acesso > 0
              ? `${numero(data.checkout.pagos_sem_acesso)} pessoa(s) pagaram e não receberam acesso.`
              : 'Todo pedido pago gerou acesso.',
          acao:
            data.checkout.pagos_sem_acesso > 0
              ? 'Verifique em Pagamentos e reenvie o convite pelo Supabase Auth.'
              : undefined,
        },
        {
          titulo: 'Pedidos com falha',
          nivel: data.checkout.falhados > 0 ? 'atencao' : 'ok',
          detalhe: `${numero(data.checkout.falhados)} pedido(s) falharam, ${numero(
            data.checkout.aguardando,
          )} aguardando pagamento.`,
        },
      ]
    : [
        {
          titulo: 'Checkout não instalado nesta base',
          nivel: 'atencao',
          detalhe: 'A tabela checkout_orders não existe neste banco.',
          acao: 'Aplique a migration 20260826090000_asaas_saas_checkout.sql, do repositório do site.',
        },
      ];

  const webhook: Sinal[] = data.webhook.instalado
    ? [
        {
          titulo: 'Último evento processado',
          // Nunca ter processado nada não é erro se o checkout também está
          // vazio — é só uma operação que ainda não começou.
          nivel: data.webhook.ultimo_processado_em ? 'ok' : 'neutro',
          detalhe: data.webhook.ultimo_processado_em
            ? dataHoraBR(data.webhook.ultimo_processado_em)
            : 'Nenhum evento processado até agora.',
        },
        {
          titulo: 'Eventos com falha',
          nivel: data.webhook.falhados > 0 ? 'erro' : 'ok',
          detalhe: `${numero(data.webhook.falhados)} falha(s) de ${numero(
            data.webhook.eventos,
          )} evento(s).`,
          acao: data.webhook.ultimo_erro
            ? `Último código de erro: ${data.webhook.ultimo_erro}`
            : undefined,
        },
      ]
    : [
        {
          titulo: 'Controle de idempotência ausente',
          nivel: 'atencao',
          detalhe: 'A tabela asaas_checkout_events não existe neste banco.',
          acao: 'Sem ela, um evento reenviado pelo gateway pode ser processado duas vezes.',
        },
      ];

  const tracking: Sinal[] = [
    {
      titulo: 'Links de parceiro ativos',
      nivel: data.tracking.links_ativos > 0 ? 'ok' : 'neutro',
      detalhe: `${numero(data.tracking.links_ativos)} link(s) ativos, ${numero(
        data.tracking.cliques_30d,
      )} clique(s) em 30 dias.`,
    },
    {
      titulo: 'Atribuições registradas',
      nivel: 'neutro',
      detalhe: `${numero(data.tracking.atribuicoes)} atribuição(ões) no total.`,
      acao: data.tracking.ultimo_clique_em
        ? `Último clique: ${dataHoraBR(data.tracking.ultimo_clique_em)}`
        : 'Nenhum clique registrado ainda.',
    },
  ];

  const repasse: Sinal[] = [
    {
      titulo: 'Parceiros com PIX cadastrado',
      nivel:
        data.repasse.parceiros_ativos > 0 &&
        data.repasse.parceiros_com_pix < data.repasse.parceiros_ativos
          ? 'atencao'
          : 'ok',
      detalhe: `${numero(data.repasse.parceiros_com_pix)} de ${numero(
        data.repasse.parceiros_ativos,
      )} parceiro(s) ativo(s).`,
      acao:
        data.repasse.parceiros_com_pix < data.repasse.parceiros_ativos
          ? 'Parceiro sem chave PIX não entra em lote de repasse.'
          : undefined,
    },
    {
      titulo: 'Comissões aguardando repasse',
      nivel: 'neutro',
      detalhe: `${numero(data.repasse.comissoes_aprovadas)} aprovada(s), ${numero(
        data.repasse.lotes_abertos,
      )} lote(s) em aberto.`,
    },
    {
      titulo: 'Portal do parceiro',
      nivel: data.repasse.portal_publicado ? 'ok' : 'neutro',
      detalhe: data.repasse.portal_publicado
        ? 'Publicado.'
        : 'Em rascunho — não está visível publicamente.',
    },
  ];

  const rlsProblemas = data.rls.filter((t) => !t.rls || t.policies === 0);

  return (
    <>
      <CabecalhoAdmin
        titulo="Status das integrações"
        descricao="Sinais medidos no banco agora, não uma lista de verificação escrita à mão."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Integrações' }]}
        acoes={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
            Verificar agora
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <BlocoSinais titulo="Checkout do site" sinais={checkout} />
        <BlocoSinais titulo="Webhook do gateway" sinais={webhook} />
        <BlocoSinais titulo="Rastreio de parceiros" sinais={tracking} />
        <BlocoSinais titulo="Repasse" sinais={repasse} />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Isolamento por RLS</CardTitle>
        </CardHeader>
        <CardContent>
          {rlsProblemas.length === 0 ? (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>
                As {numero(data.rls.length)} tabelas do back office têm RLS ligada e ao
                menos uma policy.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                {numero(rlsProblemas.length)} tabela(s) sem proteção adequada. Isso é
                vazamento entre contas, não um detalhe de configuração.
              </p>
              <div className="flex flex-wrap gap-2">
                {rlsProblemas.map((t) => (
                  <Badge key={t.tabela} variant="outline" className="border-destructive/40">
                    {t.tabela}: {t.rls ? `${t.policies} policies` : 'RLS desligada'}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Verificado em {dataHoraBR(data.verificado_em)}. Nenhuma chave, segredo ou
            payload é exibido nesta tela.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
