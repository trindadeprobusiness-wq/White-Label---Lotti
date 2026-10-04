import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Ban, RotateCcw, ArrowLeft } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { EstadoErro } from '@/components/admin/Estados';
import { DialogoConfirmacao } from '@/components/admin/DialogoConfirmacao';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDetalheUsuario, useDefinirStatusCorretor } from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import { dataBR, dataHoraBR, numero } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { rotuloAssinatura, rotuloStatusConta } from '@/lib/admin/saas';
import { AbrirPainelUsuario } from '@/components/admin/AbrirPainelUsuario';

interface DetalheCorretor {
  corretor_id: string;
  nome: string;
  email: string;
  telefone: string | null;
  creci: string | null;
  creci_estado: string | null;
  status: string;
  criado_em: string;
  ultimo_acesso_em: string | null;
  atividade: string;
  suspenso_em: string | null;
  suspenso_motivo: string | null;
  ultimo_login_auth: string | null;
  email_confirmado_em: string | null;
}

interface DetalheResposta {
  corretor: DetalheCorretor;
  uso: { clientes: number; imoveis: number; contratos: number; eventos_atividade: number };
  assinatura: { status: string; plano: string | null; ciclo: string | null } | null;
  parceiro: { parceiro_id: string; nome: string; convertido_em: string } | null;
  atividade_recente: { tipo: string; rota: string | null; criado_em: string }[];
}

const COR_STATUS: Record<string, string> = {
  ativo: 'bg-success/10 text-success border-success/20',
  suspenso: 'bg-destructive/10 text-destructive border-destructive/20',
  inativo: 'bg-muted text-muted-foreground border-border',
};

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-sm">{valor ?? '—'}</dd>
    </div>
  );
}

export default function AdminUsuarioDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [alvo, setAlvo] = useState<string | null>(null);

  const { podeExecutar } = usePapeis();
  const definirStatus = useDefinirStatusCorretor();
  const { data, isLoading, error, refetch } = useDetalheUsuario(id ?? null);

  const detalhe = data as unknown as DetalheResposta | undefined;
  const c = detalhe?.corretor;

  if (error) {
    return (
      <>
        <CabecalhoAdmin titulo="Usuário" migalhas={[{ label: 'Usuários', href: '/admin/usuarios' }]} />
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      </>
    );
  }

  if (isLoading || !c) {
    return (
      <>
        <CabecalhoAdmin titulo="Carregando..." />
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </>
    );
  }

  return (
    <>
      <CabecalhoAdmin
        titulo={c.nome}
        descricao={c.email}
        migalhas={[
          { label: 'Back office', href: '/admin' },
          { label: 'Usuários', href: '/admin/usuarios' },
          { label: c.nome },
        ]}
        acoes={
          <>
            <AbrirPainelUsuario corretorId={c.corretor_id} ativo={c.status === 'ativo'} />
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/usuarios">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar
              </Link>
            </Button>
            {c.status !== 'suspenso' && podeExecutar('suspender_usuario') && (
              <Button variant="destructive" size="sm" onClick={() => setAlvo('suspenso')}>
                <Ban className="mr-2 h-4 w-4" />
                Suspender
              </Button>
            )}
            {c.status === 'suspenso' && podeExecutar('reativar_usuario') && (
              <Button variant="default" size="sm" onClick={() => setAlvo('ativo')}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reativar
              </Button>
            )}
          </>
        }
      />

      {c.status === 'suspenso' && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5">
          <CardContent className="py-4">
            <p className="text-sm font-medium text-destructive">
              Conta suspensa em {dataHoraBR(c.suspenso_em)}
            </p>
            {c.suspenso_motivo && (
              <p className="mt-1 text-sm text-muted-foreground">
                Motivo registrado: {c.suspenso_motivo}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cadastro</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Campo
                rotulo="Status"
                valor={
                  <Badge variant="outline" className={cn(COR_STATUS[c.status])}>
                    {rotuloStatusConta(c.status)}
                  </Badge>
                }
              />
              <Campo rotulo="Telefone" valor={c.telefone} />
              <Campo
                rotulo="CRECI"
                valor={
                  c.creci === 'PENDENTE' ? (
                    // Login social não envia CRECI; o trigger handle_new_user
                    // grava 'PENDENTE'. Sinalizar aqui é útil para o suporte.
                    <span className="text-warning">Pendente de preenchimento</span>
                  ) : (
                    [c.creci, c.creci_estado].filter(Boolean).join(' / ')
                  )
                }
              />
              <Campo rotulo="Cadastro" valor={dataBR(c.criado_em)} />
              <Campo
                rotulo="E-mail confirmado"
                valor={c.email_confirmado_em ? dataBR(c.email_confirmado_em) : 'Não confirmado'}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Atividade</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Campo
                rotulo="Classificação"
                valor={
                  c.atividade === 'sem_dados' ? (
                    <span className="text-muted-foreground">Sem dados ainda</span>
                  ) : (
                    c.atividade
                  )
                }
              />
              <Campo
                rotulo="Último acesso registrado"
                valor={dataHoraBR(c.ultimo_acesso_em)}
              />
              {/* Separado de propósito: last_sign_in_at do auth é o único dado
                  histórico anterior ao back office. Misturar os dois daria a
                  impressão de termos medido atividade desde sempre. */}
              <Campo rotulo="Último login (auth)" valor={dataHoraBR(c.ultimo_login_auth)} />
              <Campo
                rotulo="Eventos registrados"
                valor={numero(detalhe?.uso.eventos_atividade ?? 0)}
              />
            </dl>
            {c.atividade === 'sem_dados' && (
              <p className="mt-4 text-xs text-muted-foreground">
                O registro de atividade começou com o back office. Ausência de dados aqui não
                significa que a conta esteja inativa.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Uso da plataforma</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-4">
              <Campo rotulo="Clientes" valor={numero(detalhe?.uso.clientes ?? 0)} />
              <Campo rotulo="Imóveis" valor={numero(detalhe?.uso.imoveis ?? 0)} />
              <Campo rotulo="Contratos" valor={numero(detalhe?.uso.contratos ?? 0)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Assinatura e origem</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Campo rotulo="Plano" valor={detalhe?.assinatura?.plano ?? 'Sem assinatura'} />
              <Campo rotulo="Situação" valor={detalhe?.assinatura ? rotuloAssinatura(detalhe.assinatura.status) : undefined} />
              <Campo
                rotulo="Parceiro de origem"
                valor={
                  detalhe?.parceiro ? (
                    <Link
                      to={`/admin/parceiros/${detalhe.parceiro.parceiro_id}`}
                      className="hover:underline"
                    >
                      {detalhe.parceiro.nome}
                    </Link>
                  ) : (
                    'Cadastro direto'
                  )
                }
              />
              {detalhe?.parceiro && (
                <Campo
                  rotulo="Atribuído em"
                  valor={dataBR(detalhe.parceiro.convertido_em)}
                />
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <DialogoConfirmacao
        aberto={!!alvo}
        aoFechar={() => setAlvo(null)}
        titulo={alvo === 'suspenso' ? 'Suspender conta?' : 'Reativar conta?'}
        descricao={
          alvo === 'suspenso'
            ? `${c.nome} perderá acesso a todos os dados enquanto a suspensão durar. Nada é excluído.`
            : `${c.nome} volta a ter acesso normal à plataforma.`
        }
        rotuloConfirmar={alvo === 'suspenso' ? 'Suspender' : 'Reativar'}
        destrutivo={alvo === 'suspenso'}
        exigirMotivo
        aoConfirmar={async (motivo) => {
          if (!alvo || !id) return;
          await definirStatus.mutateAsync({ corretorId: id, status: alvo, motivo });
        }}
      />
    </>
  );
}
