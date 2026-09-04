import { useState } from 'react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio } from '@/components/admin/Estados';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuditoria } from '@/hooks/admin/useAdminDados';
import { dataHoraBR, numero } from '@/lib/formato';

const ROTULO_ACAO: Record<string, string> = {
  definir_status_corretor: 'Alterou status de conta',
  definir_percentual: 'Alterou percentual de parceiro',
  transicionar_comissao: 'Alterou status de comissão',
  registrar_receita: 'Registrou receita',
  estornar_receita: 'Estornou receita',
  registrar_pagamento: 'Registrou pagamento a parceiro',
  conceder_papel: 'Concedeu papel administrativo',
  revogar_papel: 'Revogou papel administrativo',
};

const ROTULO_ENTIDADE: Record<string, string> = {
  corretores: 'Conta',
  parceiros: 'Parceiro',
  parceiro_comissoes: 'Comissão',
  receita_eventos: 'Receita',
  parceiro_pagamentos: 'Pagamento',
  user_roles: 'Papel',
};

const TODOS = 'TODOS';
const POR_PAGINA = 50;

/** Mostra o par antes → depois de forma legível, sem despejar JSON cru. */
function Mudanca({
  antes,
  depois,
}: {
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
}) {
  const chaves = Array.from(
    new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})]),
  );

  if (chaves.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="space-y-0.5">
      {chaves.map((chave) => {
        const de = antes?.[chave];
        const para = depois?.[chave];
        return (
          <div key={chave} className="text-xs">
            <span className="text-muted-foreground">{chave}: </span>
            {de !== undefined && de !== null && (
              <>
                <span className="line-through opacity-60">{String(de)}</span>
                <span className="text-muted-foreground"> → </span>
              </>
            )}
            <span className="font-medium">{para === undefined ? '—' : String(para)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminAuditoria() {
  const [entidade, setEntidade] = useState(TODOS);
  const [pagina, setPagina] = useState(1);

  const { data, isLoading, error, refetch } = useAuditoria({
    entidade: entidade === TODOS ? undefined : entidade,
    pagina,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <CabecalhoAdmin
        titulo="Auditoria"
        descricao="Registro imutável de toda ação administrativa sensível, com autor e justificativa."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Auditoria' }]}
      />

      <div className="mb-4 space-y-1.5">
        <Label htmlFor="filtro-entidade" className="text-xs text-muted-foreground">
          Entidade
        </Label>
        <Select
          value={entidade}
          onValueChange={(v) => {
            setEntidade(v);
            setPagina(1);
          }}
        >
          <SelectTrigger id="filtro-entidade" className="w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            {Object.entries(ROTULO_ENTIDADE).map(([valor, rotulo]) => (
              <SelectItem key={valor} value={valor}>
                {rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      ) : isLoading && itens.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : itens.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum registro de auditoria"
          descricao="Ações sensíveis — suspender conta, alterar percentual, registrar ou estornar receita, pagar comissão — passam a aparecer aqui assim que acontecerem."
        />
      ) : (
        <>
          <Card>
            <CardContent className="divide-y p-0">
              {itens.map((r) => (
                <div key={r.id} className="p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {ROTULO_ACAO[r.acao] ?? r.acao}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {ROTULO_ENTIDADE[r.entidade] ?? r.entidade}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.ator_nome ?? r.ator_email ?? 'Sistema'} ·{' '}
                        {dataHoraBR(r.criado_em)}
                      </p>
                      {r.motivo && (
                        <p className="mt-2 rounded border-l-2 border-border pl-2 text-sm text-muted-foreground">
                          {r.motivo}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 sm:text-right">
                      <Mudanca antes={r.dados_antes} depois={r.dados_depois} />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="mt-4">
            <PaginacaoAdmin
              pagina={pagina}
              porPagina={POR_PAGINA}
              total={total}
              aoMudarPagina={setPagina}
            />
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            {numero(total)} registro(s). A trilha é append-only: registros não podem ser
            alterados nem removidos, nem por um super admin.
          </p>
        </>
      )}
    </>
  );
}
