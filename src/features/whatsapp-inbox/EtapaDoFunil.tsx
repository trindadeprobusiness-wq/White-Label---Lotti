import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { crmKeys, useEtapas, useMoverOportunidade, useOportunidades } from '@/hooks/crm/useCrm';
import { corParaHex } from '@/lib/crm/cores';
import { negocioDoCliente } from './negocioDoCliente';

const PILULA = 'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium';
const ROTULO = <span className="font-semibold uppercase text-muted-foreground">Etapa</span>;

/**
 * A etapa do cliente no Funil, a mesma do cartão no quadro — antes a pílula mostrava clientes.status_funil
 * ("Qualificação") enquanto o Funil mostrava o negócio em "Novo lead". Trocar aqui é o mesmo movimento
 * de arrastar no quadro (mesma mutação, mesma proteção contra conflito), então os dois andam juntos.
 * `ultimoEventoDeEtapa`: quando o agente ou o Funil movem o negócio, o banco grava um evento 'stage' na
 * linha do tempo; ao chegar um novo, os negócios são recarregados. undefined = eventos ainda não
 * carregados; null = carregados e sem evento de etapa. Montado com key por conversa: trocar de conversa
 * não recarrega nada, só um evento novo na conversa aberta.
 */
export function EtapaDoFunil({ clienteId, ultimoEventoDeEtapa }: { clienteId: string | null; ultimoEventoDeEtapa?: string | null }) {
  const cache = useQueryClient();
  const etapas = useEtapas();
  const oportunidades = useOportunidades();
  const mover = useMoverOportunidade();
  const { negocio, outros } = negocioDoCliente(oportunidades.data, clienteId);

  const eventoVisto = useRef(ultimoEventoDeEtapa);
  useEffect(() => {
    if (ultimoEventoDeEtapa === undefined) return;
    if (eventoVisto.current !== undefined && ultimoEventoDeEtapa !== eventoVisto.current) {
      void cache.invalidateQueries({ queryKey: crmKeys.oportunidades() });
    }
    eventoVisto.current = ultimoEventoDeEtapa;
  }, [ultimoEventoDeEtapa, cache]);
  // Negócio criado depois (o evento 'stage' não sai na criação): ao abrir a conversa sem negócio, confere de novo.
  const semNegocio = !!clienteId && oportunidades.isSuccess && !negocio;
  useEffect(() => {
    if (semNegocio) void cache.invalidateQueries({ queryKey: crmKeys.oportunidades() });
  }, [semNegocio, clienteId, cache]);

  if (!clienteId) return <span data-testid="conversation-stage-pill" className={PILULA}>{ROTULO}<span>Sem cliente vinculado</span></span>;
  // Falha ao carregar (API fora, sessão vencida) não pode virar "Sem negócio no funil": isso afirmaria algo falso.
  if ((oportunidades.isError && !oportunidades.data) || (etapas.isError && !etapas.data)) {
    return <button type="button" data-testid="conversation-stage-pill" title="Não foi possível carregar o Funil de Vendas. Clique para tentar de novo."
      onClick={() => { void oportunidades.refetch(); void etapas.refetch(); }} className={`${PILULA} hover:bg-primary/10`}>{ROTULO}<span>Etapa indisponível</span></button>;
  }
  if (oportunidades.isPending || etapas.isPending) return <span data-testid="conversation-stage-pill" className={PILULA}>{ROTULO}<span className="text-muted-foreground">…</span></span>;
  if (!negocio) return <span data-testid="conversation-stage-pill" title="Este cliente não tem negócio aberto no Funil de Vendas." className={PILULA}>{ROTULO}<span>Sem negócio no funil</span></span>;

  const lista = [...(etapas.data ?? [])].filter(e => e.ativo).sort((a, b) => a.ordem - b.ordem);
  const atual = lista.find(e => e.id === negocio.etapa_id);
  const mudar = (etapaId: string) => {
    if (etapaId === negocio.etapa_id) return;
    mover.mutate({
      id: negocio.id,
      etapaId,
      // Igual ao arrastar no quadro: o cartão entra no fim da coluna de destino.
      ordem: (oportunidades.data ?? []).filter(o => o.etapa_id === etapaId).length,
      updatedAt: negocio.updated_at, // token de concorrência
    });
  };

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" data-testid="conversation-stage-pill" aria-label={`Etapa no funil: ${atual?.nome ?? 'etapa desativada'}. Trocar etapa`}
        title={outros ? `Negócio "${negocio.titulo}" (o cliente tem mais ${outros} aberto${outros > 1 ? 's' : ''} no Funil)` : `Negócio "${negocio.titulo}"`}
        disabled={mover.isPending} className={`${PILULA} hover:bg-primary/10 disabled:opacity-60`}>
        {ROTULO}
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: atual ? corParaHex(atual.cor) : undefined }} />
        <span>{atual?.nome ?? 'Etapa desativada'}</span>
        {outros > 0 && <span className="rounded-full bg-muted px-1 text-[9px] text-muted-foreground">+{outros}</span>}
        <ChevronDown aria-hidden className="h-3 w-3 text-muted-foreground" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Mover no Funil de Vendas</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {lista.map(etapa => <DropdownMenuItem key={etapa.id} onSelect={() => mudar(etapa.id)} className="gap-2 text-[12px]">
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: corParaHex(etapa.cor) }} />
        <span className="flex-1">{etapa.nome}</span>
        {etapa.id === negocio.etapa_id && <Check aria-hidden className="h-3.5 w-3.5 text-primary" />}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
