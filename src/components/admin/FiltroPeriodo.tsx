import { CalendarRange } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ATALHOS,
  periodoDeAtalho,
  periodoValido,
  type AtalhoPeriodo,
  type Periodo,
} from '@/lib/admin/periodo';
import { dataBR } from '@/lib/formato';

interface FiltroPeriodoProps {
  atalho: AtalhoPeriodo | 'personalizado';
  periodo: Periodo;
  aoMudar: (atalho: AtalhoPeriodo | 'personalizado', periodo: Periodo) => void;
}

export function FiltroPeriodo({ atalho, periodo, aoMudar }: FiltroPeriodoProps) {
  const personalizado = atalho === 'personalizado';
  const invalido = personalizado && !periodoValido(periodo);

  const mudarAtalho = (valor: string) => {
    if (valor === 'personalizado') {
      aoMudar('personalizado', periodo);
      return;
    }
    const novo = valor as AtalhoPeriodo;
    aoMudar(novo, periodoDeAtalho(novo));
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="filtro-periodo" className="text-xs text-muted-foreground">
          Período
        </Label>
        <Select value={atalho} onValueChange={mudarAtalho}>
          <SelectTrigger id="filtro-periodo" className="w-full sm:w-[190px]">
            <CalendarRange className="mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ATALHOS.map((a) => (
              <SelectItem key={a.valor} value={a.valor}>
                {a.label}
              </SelectItem>
            ))}
            <SelectItem value="personalizado">Personalizado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {personalizado ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="periodo-inicio" className="text-xs text-muted-foreground">
              De
            </Label>
            <Input
              id="periodo-inicio"
              type="date"
              value={periodo.inicio}
              max={periodo.fim}
              onChange={(e) => aoMudar('personalizado', { ...periodo, inicio: e.target.value })}
              className="w-full sm:w-[150px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="periodo-fim" className="text-xs text-muted-foreground">
              Até
            </Label>
            <Input
              id="periodo-fim"
              type="date"
              value={periodo.fim}
              min={periodo.inicio}
              onChange={(e) => aoMudar('personalizado', { ...periodo, fim: e.target.value })}
              className="w-full sm:w-[150px]"
            />
          </div>
        </>
      ) : (
        <p className="pb-2 text-sm text-muted-foreground">
          {dataBR(periodo.inicio)} até {dataBR(periodo.fim)}
        </p>
      )}

      {invalido && (
        <p className="pb-2 text-sm text-destructive" role="alert">
          A data inicial precisa vir antes da final.
        </p>
      )}
    </div>
  );
}
