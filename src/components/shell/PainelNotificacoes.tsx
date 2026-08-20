import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, Inbox, ArrowDownLeft, ArrowUpRight, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useCRMStore } from '@/stores/crmStore';
import { useAlertasAoVivo } from '@/hooks/useAlertasAoVivo';
import { mensagemDeErro } from '@/lib/errors';
import { moeda } from '@/lib/formato';
import { ocultarDadoSensivel, mascararValoresNoTexto } from '@/lib/privacidade';
import { usePrivacidade } from '@/stores/privacidadeStore';
import {
  ordenarNotificacoes,
  filtrarPorCategoria,
  destinoDoAlerta,
  tempoRelativo,
  tomDoAlerta,
  contarNaoLidas,
  rotuloContagem,
  sinalDoAlerta,
  valorDoAlerta,
  movimentouSaldo,
  agruparPorDia,
  ROTULO_TIPO,
  type AlertaNotificacao,
  type CategoriaNotificacao,
} from '@/lib/notificacoes';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

/**
 * Sino de notificações, no modelo do painel do Asaas.
 *
 * Três coisas o definem, e as três vieram de como o Asaas resolve o mesmo
 * problema:
 *
 *  1. **Número, não ponto.** "3" e "1" pedem ações diferentes do corretor; o
 *     ponto colapsava as duas no mesmo sinal.
 *  2. **Valor na própria linha.** A primeira pergunta diante de um alerta de
 *     dinheiro é "quanto", e a segunda é "de quem" — as duas ficam visíveis
 *     sem precisar abrir a fatura.
 *  3. **Chega sozinho.** Ver `useAlertasAoVivo`: antes o sino só atualizava no
 *     F5, o que o tornava histórico em vez de notificação.
 *
 * A fonte continua sendo a tabela `alertas`, alimentada pelo webhook do Asaas.
 * Nenhuma regra de negócio vive aqui.
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

/** Quanto o painel mostra antes de virar rolagem infinita sem valor. */
const LIMITE_PAINEL = 30;

export function PainelNotificacoes() {
  const [aberto, setAberto] = useState(false);
  const [categoria, setCategoria] = useState<CategoriaNotificacao>('todas');
  const [marcando, setMarcando] = useState(false);
  const [chegouAgora, setChegouAgora] = useState(false);
  const navigate = useNavigate();

  const { alertas, marcarAlertaLido, fetchAlertas } = useCRMStore();
  // O sino mostra quanto entrou e quanto saiu. Com o modo privado ligado,
  // e ele fica aberto na tela, seria a maior brecha do sistema.
  const valoresOcultos = usePrivacidade((s) => s.valoresOcultos);

  // Realtime + sondagem. Sem isto, todo o resto mostra dado do bootstrap.
  useAlertasAoVivo();

  const lista = alertas as unknown as AlertaNotificacao[];
  const contagem = useMemo(() => contarNaoLidas(lista), [lista]);
  const grupos = useMemo(
    () => agruparPorDia(
      ordenarNotificacoes(filtrarPorCategoria(lista, categoria)).slice(0, LIMITE_PAINEL),
    ),
    [lista, categoria],
  );

  // Balança o sino quando o número sobe. É o único aviso que o corretor tem se
  // estiver noutra tela do sistema — sem isso, dinheiro entra e nada muda.
  const anterior = useRef(contagem.total);
  useEffect(() => {
    if (contagem.total > anterior.current) {
      anterior.current = contagem.total;
      setChegouAgora(true);
      const t = setTimeout(() => setChegouAgora(false), 1200);
      return () => clearTimeout(t);
    }
    anterior.current = contagem.total;
  }, [contagem.total]);

  const abrirAlerta = (alerta: AlertaNotificacao) => {
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
      // Caminho preferido: uma chamada só, com o filtro por corretor dentro da
      // função. Mas o front NÃO pode depender de a migration já ter sido
      // aplicada — código e banco sobem em momentos diferentes, e assumir o
      // contrário deixou este botão quebrado em produção.
      const { error } = await supabase.rpc('marcar_alertas_lidos' as never, {
        _ids: null,
      } as never);

      if (error) {
        // PGRST202 = função ausente do schema cache; 42883 = não existe.
        const semRpc =
          error.code === 'PGRST202' ||
          error.code === '42883' ||
          /could not find the function|does not exist/i.test(error.message ?? '');

        if (!semRpc) throw error;

        // Fallback: marca uma a uma. Mais requisições, mesmo resultado — e a
        // RLS de `alertas` já garante que só as do próprio corretor mudam.
        const naoLidas = lista.filter((a) => !a.lido);
        await Promise.all(naoLidas.map((a) => marcarAlertaLido(a.id)));
      }

      await fetchAlertas();
      toast.success('Notificações marcadas como lidas.');
    } catch (e) {
      toast.error(mensagemDeErro(e, 'Não foi possível marcar as notificações.'));
    } finally {
      setMarcando(false);
    }
  };

  const badge = rotuloContagem(contagem.total);

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
          <Bell
            className={cn(
              'h-[18px] w-[18px]',
              chegouAgora && 'motion-safe:animate-sino',
            )}
          />
          {badge && (
            <span
              className={cn(
                // Encostado na borda do ícone, como no Asaas, em vez de
                // flutuar no meio da área de toque de 44px.
                'absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center',
                'rounded-full px-1 text-[10px] font-semibold leading-none tabular',
                'ring-2 ring-background',
                // Vermelho só quando há algo crítico: um repasse que falhou não
                // pode ter o mesmo peso visual de um follow-up.
                contagem.criticas > 0
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-primary text-primary-foreground',
              )}
              aria-hidden="true"
            >
              {badge}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(25rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Notificações</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {contagem.total > 0
                ? `${contagem.total} não lida${contagem.total > 1 ? 's' : ''}`
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
          {grupos.length === 0 ? (
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
            grupos.map((grupo, i) => (
              <div key={`${grupo.rotulo}-${i}`}>
                <p className="sticky top-0 z-10 bg-muted/80 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
                  {grupo.rotulo}
                </p>
                <ul className="divide-y divide-border">
                  {grupo.itens.map((alerta) => {
                    const tom = tomDoAlerta(alerta);
                    const { classe, Icone } = ICONE_TOM[tom] ?? ICONE_TOM.neutro;
                    const clicavel = !!destinoDoAlerta(alerta);
                    const valor = valorDoAlerta(alerta);
                    const sinal = sinalDoAlerta(alerta);
                    const moveu = movimentouSaldo(alerta);

                    return (
                      <li key={alerta.id}>
                        <button
                          type="button"
                          onClick={() => abrirAlerta(alerta)}
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
                              {valoresOcultos
                                ? mascararValoresNoTexto(alerta.mensagem)
                                : alerta.mensagem}
                            </span>
                          </span>

                          <span className="flex shrink-0 flex-col items-end gap-1.5">
                            {valor !== null && sinal && (
                              <span
                                className={cn(
                                  'whitespace-nowrap text-sm font-semibold tabular',
                                  !moveu
                                    ? 'text-destructive line-through decoration-1'
                                    : sinal === 'entrada'
                                      ? 'text-success'
                                      : 'text-foreground',
                                )}
                              >
                                {!valoresOcultos && moveu &&
                                  (sinal === 'entrada' ? '+ ' : '− ')}
                                {valoresOcultos
                                  ? ocultarDadoSensivel(valor, 'valor')
                                  : moeda(valor)}
                              </span>
                            )}
                            {!alerta.lido && (
                              <span
                                className="h-2 w-2 rounded-full bg-primary"
                                aria-label="Não lida"
                              />
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
