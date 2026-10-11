import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, parseISO } from 'date-fns';
import { diaDoLancamento } from '@/lib/formato';
import { Calendar as CalendarIcon, Plus, Edit2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useFinanceiro } from '@/hooks/useFinanceiro';
import {
  TipoLancamento,
  CategoriaFinanceira,
  CATEGORIA_LABELS,
  CATEGORIAS_DESPESA,
  CATEGORIAS_RECEITA,
  LancamentoFinanceiro,
} from '@/types/financeiro';
import { toast } from 'sonner';

const schema = z.object({
  tipo: z.enum(['RECEITA', 'DESPESA']),
  categoria: z.string().min(1, 'Selecione uma categoria'),
  descricao: z.string().min(3, 'Descrição muito curta'),
  valor: z.number().min(0.01, 'Valor deve ser maior que zero'),
  data: z.date(),
  recorrente: z.boolean().default(false),
});

type FormData = z.infer<typeof schema>;

interface NovoLancamentoDialogProps {
  onSuccess?: () => void;
  lancamentoToEdit?: LancamentoFinanceiro | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function NovoLancamentoDialog({
  onSuccess,
  lancamentoToEdit,
  open: controlledOpen,
  onOpenChange: setControlledOpen
}: NovoLancamentoDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [tipo, setTipo] = useState<TipoLancamento>('DESPESA');
  const { addLancamento, updateLancamento } = useFinanceiro();

  const open = controlledOpen ?? internalOpen;
  const setOpen = setControlledOpen ?? setInternalOpen;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      tipo: 'DESPESA',
      data: new Date(),
      recorrente: false,
    },
  });

  // Populate form for editing
  useEffect(() => {
    if (lancamentoToEdit && open) {
      setTipo(lancamentoToEdit.tipo);
      setValue('tipo', lancamentoToEdit.tipo);
      setValue('categoria', lancamentoToEdit.categoria);
      setValue('descricao', lancamentoToEdit.descricao);
      setValue('valor', Number(lancamentoToEdit.valor));

      // Vale o dia gravado ('2026-10-01' ou '2026-10-01T00:00:00+00:00'): lido no fuso local, o ISO virava o
      // dia anterior e salvar sem mexer na data gravava esse dia errado.
      const dia = diaDoLancamento(lancamentoToEdit.data);
      if (lancamentoToEdit.data && !dia) console.error("Invalid date found in record:", lancamentoToEdit.data);
      const safeDate = dia ?? new Date();

      setValue('data', safeDate);
      setValue('recorrente', lancamentoToEdit.recorrente ?? false);
    } else if (!lancamentoToEdit && open) {
      // Reset logic for new entry
      const now = new Date();
      reset({
        tipo: 'DESPESA',
        // Ensure strictly 'today'
        data: now,
        recorrente: false,
        categoria: '',
        descricao: '',
        valor: undefined,
      });
      setTipo('DESPESA');
    }
  }, [lancamentoToEdit, open, setValue, reset]);

  const selectedDate = watch('data');
  const isRecorrente = watch('recorrente');

  const categorias = tipo === 'DESPESA' ? CATEGORIAS_DESPESA : CATEGORIAS_RECEITA;

  const onSubmit = async (data: FormData) => {
    try {
      const formattedDate = format(data.data, 'yyyy-MM-dd');

      if (lancamentoToEdit) {
        await updateLancamento(lancamentoToEdit.id, {
          tipo: data.tipo,
          categoria: data.categoria as CategoriaFinanceira,
          descricao: data.descricao,
          valor: data.valor,
          data: formattedDate,
          recorrente: data.recorrente,
        });
        toast.success('Lançamento atualizado com sucesso!');
      } else {
        await addLancamento({
          tipo: data.tipo,
          categoria: data.categoria as CategoriaFinanceira,
          descricao: data.descricao,
          valor: data.valor,
          data: formattedDate,
          recorrente: data.recorrente,
        });
        toast.success(`${tipo === 'RECEITA' ? 'Receita' : 'Despesa'} registrada com sucesso!`);
      }

      reset();
      setOpen(false);
      onSuccess?.();
    } catch (error) {
      toast.error('Erro ao salvar lançamento');
      console.error(error);
    }
  };

  const handleTipoChange = (novoTipo: string) => {
    setTipo(novoTipo as TipoLancamento);
    setValue('tipo', novoTipo as TipoLancamento);
    setValue('categoria', '');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Only show trigger if not controlled (i.e., used as standalone button) */}
      {!setControlledOpen && (
        <DialogTrigger asChild>
          <Button id="btn-novo-lancamento">
            <Plus className="h-4 w-4 mr-2" />
            Novo Lançamento
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {lancamentoToEdit ? 'Editar Lançamento' : 'Registrar Lançamento Financeiro'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Tabs value={tipo} onValueChange={handleTipoChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="DESPESA" className="data-[state=active]:bg-red-500 data-[state=active]:text-white">
                💸 Despesa
              </TabsTrigger>
              <TabsTrigger value="RECEITA" className="data-[state=active]:bg-green-500 data-[state=active]:text-white">
                💰 Receita
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="categoria">Categoria</Label>
              <Select
                onValueChange={(value) => setValue('categoria', value)}
                value={watch('categoria')} // Controlled value for edit mode
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORIA_LABELS[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.categoria && (
                <p className="text-sm text-destructive">{errors.categoria.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="descricao">Descrição</Label>
              <Textarea
                id="descricao"
                placeholder="Ex: Anúncio no ZAP Imóveis - Janeiro"
                {...register('descricao')}
              />
              {errors.descricao && (
                <p className="text-sm text-destructive">{errors.descricao.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="valor">Valor (R$)</Label>
                <Input
                  id="valor"
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  {...register('valor', { valueAsNumber: true })}
                />
                {errors.valor && (
                  <p className="text-sm text-destructive">{errors.valor.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Data</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !selectedDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, 'dd/MM/yyyy') : 'Selecione'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => date && setValue('data', date)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="recorrente">Lançamento Recorrente</Label>
                <p className="text-xs text-muted-foreground">
                  Marque se este custo se repete mensalmente
                </p>
              </div>
              <Switch
                id="recorrente"
                checked={isRecorrente}
                onCheckedChange={(checked) => setValue('recorrente', checked)}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className={cn(
                "flex-1",
                tipo === 'RECEITA' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
              )}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
