import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { AvisoContratosEmRisco } from '@/components/clientes/AvisoContratosEmRisco';
import type { ContratoEmRisco } from '@/hooks/crm/useContratosDosClientes';
import { Button } from '@/components/ui/button';

/**
 * Prévia, só em desenvolvimento, da caixa de excluir clientes em lote quando
 * alguns deles têm contrato. Mostra o componente de verdade, com dados falsos.
 */
const TODOS: ContratoEmRisco[] = [
  { id: 'k1', clienteId: 'h', tipo: 'LOCACAO_RESIDENCIAL', status: 'ATIVO', imovel: 'Apartamento 603 - Jardins do Éden' },
  { id: 'k2', clienteId: 'h', tipo: 'LOCACAO_RESIDENCIAL', status: 'ATIVO', imovel: 'Casa Bruno - Jd América, cs 01' },
  { id: 'k3', clienteId: 's', tipo: 'LOCACAO_RESIDENCIAL', status: 'ENCERRADO', imovel: 'Casa residencial, Rua Adriana Patricia' },
];
const NOMES: Record<string, string> = { h: 'Hélio Ferreira Neves', s: 'Shirley Pereira de Figueiredo', m: 'Maria (sem contrato)' };

export default function ExcluirClientePreview() {
  const [marcados, setMarcados] = useState(new Set(['h', 's', 'm']));
  const contratos = TODOS.filter((c) => marcados.has(c.clienteId));
  const consulta = { isPending: false, isError: false, isSuccess: true, data: contratos } as unknown as UseQueryResult<ContratoEmRisco[]>;
  const bloqueado = contratos.length > 0;
  return <div className="flex min-h-dvh items-start justify-center bg-black/40 p-6">
    <div role="alertdialog" className="w-full max-w-lg space-y-4 rounded-lg border bg-background p-6 shadow-lg">
      <h2 className="text-lg font-semibold">Excluir {marcados.size} cliente(s)?</h2>
      <p className="text-sm text-muted-foreground">O histórico, as tarefas e os negócios no funil de cada um saem junto. Esta ação não pode ser desfeita.</p>
      <AvisoContratosEmRisco
        consulta={consulta}
        nomeDoCliente={(id) => NOMES[id]}
        onDesmarcar={(ids) => setMarcados((a) => { const n = new Set(a); ids.forEach((i) => n.delete(i)); return n; })}
        onMostrarNaLista={() => undefined}
      />
      {bloqueado && <p className="text-xs text-muted-foreground">Desmarque quem tem contrato para excluir os demais.</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline">Cancelar</Button>
        <Button variant="destructive" disabled={bloqueado || marcados.size === 0}>Excluir</Button>
      </div>
    </div>
  </div>;
}
