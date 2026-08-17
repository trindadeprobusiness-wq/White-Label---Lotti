import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useDefinirPercentual } from '@/hooks/admin/useAdminDados';
import { ROTULO_BASE } from '@/lib/admin/comissao';
import { dataBR, moeda, percentual as fmtPercentual } from '@/lib/formato';
import { paraISO, somarDias } from '@/lib/admin/periodo';
import type { BaseCalculo, PercentualParceiro } from '@/integrations/supabase/admin-types';

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  parceiroId: string;
  vigenteAtual: PercentualParceiro | null;
}

const BASES: BaseCalculo[] = [
  'receita_bruta',
  'receita_liquida',
  'primeiro_pagamento',
  'valor_fixo',
];

export function DialogoPercentual({ aberto, aoFechar, parceiroId, vigenteAtual }: Props) {
  const definir = useDefinirPercentual();

  const [valor, setValor] = useState('10');
  const [base, setBase] = useState<BaseCalculo>('receita_bruta');
  const [valorFixo, setValorFixo] = useState('');
  const [inicio, setInicio] = useState('');
  const [motivo, setMotivo] = useState('');

  // A nova vigência precisa começar DEPOIS do início da atual — é isso que
  // impede reescrever a regra de comissões já geradas no intervalo. O default
  // é amanhã, ou hoje quando não há regra anterior.
  const minimo = vigenteAtual
    ? somarDias(vigenteAtual.vigencia_inicio, 1)
    : paraISO(new Date());

  useEffect(() => {
    if (!aberto) return;
    setValor(vigenteAtual ? String(vigenteAtual.percentual) : '10');
    setBase(vigenteAtual?.base_calculo ?? 'receita_bruta');
    setValorFixo(vigenteAtual?.valor_fixo ? String(vigenteAtual.valor_fixo) : '');
    setInicio(minimo > paraISO(new Date()) ? minimo : paraISO(new Date()));
    setMotivo('');
  }, [aberto, vigenteAtual, minimo]);

  const numeroValor = Number(valor.replace(',', '.'));
  const numeroFixo = Number(valorFixo.replace(',', '.'));

  const erroValor =
    base === 'valor_fixo'
      ? !valorFixo || Number.isNaN(numeroFixo) || numeroFixo < 0
        ? 'Informe o valor fixo por cliente'
        : null
      : Number.isNaN(numeroValor) || numeroValor < 0 || numeroValor > 100
        ? 'O percentual precisa estar entre 0 e 100'
        : null;

  const erroData = inicio < minimo ? `A vigência precisa começar em ${dataBR(minimo)} ou depois` : null;
  const podeSalvar = !erroValor && !erroData && !!inicio;

  const salvar = async () => {
    if (!podeSalvar) return;
    await definir.mutateAsync({
      parceiroId,
      percentual: base === 'valor_fixo' ? 0 : numeroValor,
      baseCalculo: base,
      valorFixo: base === 'valor_fixo' ? numeroFixo : null,
      vigenciaInicio: inicio,
      motivo: motivo.trim() || undefined,
    });
    aoFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(e) => !e && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {vigenteAtual ? 'Alterar percentual' : 'Definir percentual'}
          </DialogTitle>
          <DialogDescription>
            {vigenteAtual
              ? 'A regra atual será encerrada na véspera da nova vigência. Comissões já geradas não mudam.'
              : 'Sem uma regra vigente, nenhuma receita deste parceiro gera comissão.'}
          </DialogDescription>
        </DialogHeader>

        {vigenteAtual && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="text-muted-foreground">Regra atual</p>
            <p className="mt-0.5 font-medium">
              {vigenteAtual.base_calculo === 'valor_fixo'
                ? moeda(vigenteAtual.valor_fixo)
                : fmtPercentual(vigenteAtual.percentual)}{' '}
              · {ROTULO_BASE[vigenteAtual.base_calculo]}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Desde {dataBR(vigenteAtual.vigencia_inicio)}
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pc-base">Base de cálculo</Label>
            <Select value={base} onValueChange={(v) => setBase(v as BaseCalculo)}>
              <SelectTrigger id="pc-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {ROTULO_BASE[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {base === 'valor_fixo' ? (
            <div className="space-y-2">
              <Label htmlFor="pc-fixo">Valor fixo por cliente (R$)</Label>
              <Input
                id="pc-fixo"
                inputMode="decimal"
                value={valorFixo}
                onChange={(e) => setValorFixo(e.target.value)}
                placeholder="150,00"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="pc-valor">Percentual (%)</Label>
              <Input
                id="pc-valor"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="10"
              />
            </div>
          )}
          {erroValor && <p className="text-sm text-destructive">{erroValor}</p>}

          <div className="space-y-2">
            <Label htmlFor="pc-inicio">Início da vigência</Label>
            <Input
              id="pc-inicio"
              type="date"
              value={inicio}
              min={minimo}
              onChange={(e) => setInicio(e.target.value)}
            />
            {erroData ? (
              <p className="text-sm text-destructive">{erroData}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Receitas confirmadas a partir desta data usam a nova regra.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pc-motivo">Motivo (fica no histórico)</Label>
            <Textarea
              id="pc-motivo"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: renegociação anual acordada em reunião"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={definir.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={!podeSalvar || definir.isPending}>
            {definir.isPending ? 'Salvando...' : 'Criar vigência'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
