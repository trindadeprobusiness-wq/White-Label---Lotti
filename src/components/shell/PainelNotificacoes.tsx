import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Inbox, ArrowDownLeft, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useCRMStore } from '@/stores/crmStore';
import { mensagemDeErro } from '@/lib/errors';
import {
  ordenarNotificacoes,
  filtrarPorCategoria,
  destinoDoAlerta,
  tempoRelativo,
  tomDoAlerta,
  contarNaoLidas,
  ROTULO_TIPO,
  type AlertaNotificacao,
  type CategoriaNotificacao,
} from '@/lib/notificacoes';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

/**
 * Sino de notificações.
 *
 * Antes o sino era decorativo: mostrava um ponto quando havia alerta não lido,
 * mas não abria nada — não dava para ver o que era nem agir. Agora ele lista
 * os alertas, leva à entidade de origem e permite marcar como lido.
 *
 * O que motivou: recebimento de fatura e confirmação de repasse passaram a
 * chegar pelo webhook do Asaas, e essas são as duas coisas que o corretor mais
 * quer saber assim que acontecem.
 */

const ICONE_TOM: Record<string, { classe: string; Icone: typeof Bell }> = {
  success: { classe: 'bg-success-surface text-success', Icone: ArrowDownLeft },
  info: { classe: 'bg-info-surface text-info', Icone: ArrowUpRight },
  destructive: { classe: 'bg-destructive-surface text-destructive', Icone: AlertTriangle },
  warning: { classe: 'bg-warning-surface text-warning', Icone: Bell },
  neutro: { classe: 'bg-muted text-muted-foreground', Icone: Bell },
};

const CATEGORIAS: { valor: CategoriaNotificacao; label: string }[] = [
  { valor: 'todas', label: 'Todas' },
  { valor: 'financeiro', label: 'Financeiro' },
  { valor: 'operacao', label: 'Operação' },
];

export function PainelNotificacoes() {
  const [aberto, setAberto] = useState(false);
  const [categoria, setCategoria] = useState<CategoriaNotificacao>('todas');
  const [marcando, setMarcando] = useState(false);
  const navigate = useNavigate();

  const { alertas, marcarAlertaLido, fetchAlertas } = useCRMStore();

  const lista = alertas as unknown as AlertaNotificacao[];
  const contagem = useMemo(() => contarNaoLidas(lista), [lista]);
  const visiveis = useMemo(
    () => ordenarNotificacoes(filtrarPorCategoria(lista, categoria)).slice(0, 30),
    [lista, categoria],
  );

  const abrirAlerta = async (alerta: AlertaNotificacao) => {
    const destino = destinoDoAlerta(alerta);
    if (!alerta.lido) {
      // Não aguarda: navegar é a intenção do clique, marcar como lido é efeito.
      void marcarAlertaLido(alerta.id);
    }
    if (destino) {
      setAberto(false);
      navigate(destino);
    }
  };

  const marcarTodas = async () => {
    setMarcando(true);
    try {
      // Uma chamada, não N updates. A RPC filtra pelo corretor da sessão.
      const { error } = await supabase.rpc('marcar_alertas_lidos' as never, {
        _ids: null,
      } as never);
      if (error) throw error;
      await fetchAlertas();
      toast.success('Notificações marcadas como lidas.');
    } catch (e) {
      toast.error(mensagemDeErro(e, 'Não foi possível marcar as notificações.'));
    } finally {
      setMarcando(false);
    }
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-ring"
          aria-label={
            contagem.total > 0
              ? `Notificações: ${contagem.total} não lida(s)`
              : 'Notificações'
          }
        >
          <Bell className="h-[18px] w-[18px]" />
          {contagem.total > 0 && (
            <span
              className={cn(
                'absolute right-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-background',
                // Ponto vermelho quando há algo crítico — um repasse que falhou
                // não pode ter o mesmo peso visual de um follow-up.
                contagem.criticas > 0 ? 'bg-destructive' : 'bg-warning',
              )}
              aria-hidden="true"
            />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Notificações</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {contagem.total > 0
                ? `${contagem.total} não lida(s)`
                : 'Tudo em dia'}
            </p>
          </div>
          {contagem.total > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void marcarTodas()}
              disabled={marcando}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" />
              {marcando ? 'Marcando...' : 'Marcar lidas'}
            </Button>
          )}
        </div>

        <div className="flex gap-1 border-b border-border px-2 py-2">
          {CATEGORIAS.map((c) => (
            <button
              key={c.valor}
              type="button"
              onClick={() => setCategoria(c.valor)}
              aria-pressed={categoria === c.valor}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-ring',
                categoria === c.valor
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {c.label}
              {c.valor === 'financeiro' && contagem.financeiro > 0 && (
                <span className="ml-1.5 tabular">{contagem.financeiro}</span>
              )}
            </button>
          ))}
        </div>

        <div className="max-h-[26rem] overflow-y-auto">
          {visiveis.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-foreground">
                {categoria === 'financeiro'
                  ? 'Nenhuma movimentação financeira'
                  : 'Nenhuma notificação'}
              </p>
              <p className="max-w-[16rem] text-xs leading-relaxed text-muted-foreground">
                {categoria === 'financeiro'
                  ? 'Recebimentos e repasses confirmados no Asaas aparecem aqui assim que acontecem.'
                  : 'Você será avisado quando algo precisar de atenção.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visiveis.map((alerta) => {
                const tom = tomDoAlerta(alerta);
                const { classe, Icone } = ICONE_TOM[tom] ?? ICONE_TOM.neutro;
                const clicavel = !!destinoDoAlerta(alerta);

                return (
                  <li key={alerta.id}>
                    <button
                      type="button"
                      onClick={() => void abrirAlerta(alerta)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150',
                        'hover:bg-muted focus-ring',
                        !clicavel && 'cursor-default',
                        !alerta.lido && 'bg-surface-brand/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          classe,
                        )}
                      >
                        <Icone className="h-4 w-4" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {ROTULO_TIPO[alerta.tipo ?? ''] ?? 'Aviso'}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {tempoRelativo(alerta.created_at)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'mt-0.5 block text-sm leading-snug',
                            alerta.lido ? 'text-muted-foreground' : 'font-medium text-foreground',
                          )}
                        >
                          {alerta.mensagem}
                        </span>
                      </span>

                      {!alerta.lido && (
                        <span
                          className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary"
                          aria-label="Não lida"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
