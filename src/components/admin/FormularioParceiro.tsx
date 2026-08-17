import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { useSalvarParceiro } from '@/hooks/admin/useAdminDados';
import { validarCPF, validarCNPJ, formatarCpfCnpj, formatarTelefone } from '@/lib/validators';
import type { Parceiro } from '@/integrations/supabase/admin-types';

/**
 * Reusa validarCPF/validarCNPJ/formatarCpfCnpj de src/lib/validators.ts, que já
 * existiam e checam dígito verificador — não vale reimplementar isso.
 */
const schema = z.object({
  nome: z.string().min(2, 'Informe o nome do parceiro'),
  empresa: z.string().optional(),
  documento: z
    .string()
    .optional()
    .refine((v) => {
      if (!v) return true;
      const d = v.replace(/\D/g, '');
      if (d.length === 11) return validarCPF(d);
      if (d.length === 14) return validarCNPJ(d);
      return false;
    }, { message: 'CPF ou CNPJ inválido' }),
  email: z.string().email('E-mail inválido'),
  telefone: z.string().optional(),
  responsavel: z.string().optional(),
  status: z.enum(['ativo', 'inativo', 'suspenso', 'encerrado']),
  janela_atribuicao_dias: z
    .number({ invalid_type_error: 'Informe um número de dias' })
    .int('Use um número inteiro')
    .min(1, 'Mínimo de 1 dia')
    .max(730, 'Máximo de 730 dias'),
  observacoes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  parceiro?: Parceiro | null;
}

export function FormularioParceiro({ aberto, aoFechar, parceiro }: Props) {
  const salvar = useSalvarParceiro();
  const editando = !!parceiro;

  const {
    register, handleSubmit, reset, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: '', email: '', status: 'ativo', janela_atribuicao_dias: 90,
    },
  });

  // Reabrir com os dados de outro parceiro ainda no formulário salvaria no
  // registro errado.
  useEffect(() => {
    if (!aberto) return;
    reset({
      nome: parceiro?.nome ?? '',
      empresa: parceiro?.empresa ?? '',
      documento: parceiro?.documento ?? '',
      email: parceiro?.email ?? '',
      telefone: parceiro?.telefone ?? '',
      responsavel: parceiro?.responsavel ?? '',
      status: (parceiro?.status as FormData['status']) ?? 'ativo',
      janela_atribuicao_dias: parceiro?.janela_atribuicao_dias ?? 90,
      observacoes: parceiro?.observacoes ?? '',
    });
  }, [aberto, parceiro, reset]);

  const aoSalvar = async (dados: FormData) => {
    await salvar.mutateAsync({
      ...(parceiro?.id ? { id: parceiro.id } : {}),
      nome: dados.nome.trim(),
      empresa: dados.empresa?.trim() || null,
      documento: dados.documento?.replace(/\D/g, '') || null,
      email: dados.email.trim().toLowerCase(),
      telefone: dados.telefone?.trim() || null,
      responsavel: dados.responsavel?.trim() || null,
      status: dados.status,
      janela_atribuicao_dias: dados.janela_atribuicao_dias,
      observacoes: dados.observacoes?.trim() || null,
    });
    aoFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(e) => !e && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar parceiro' : 'Novo parceiro'}</DialogTitle>
          <DialogDescription>
            {editando
              ? 'Alterações de cadastro não afetam comissões já geradas.'
              : 'Depois de salvar, gere o link exclusivo na página do parceiro.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(aoSalvar)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="p-nome">
              Nome <span className="text-destructive">*</span>
            </Label>
            <Input id="p-nome" {...register('nome')} placeholder="Nome do parceiro" />
            {errors.nome && <p className="text-sm text-destructive">{errors.nome.message}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-empresa">Empresa</Label>
              <Input id="p-empresa" {...register('empresa')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-documento">CPF ou CNPJ</Label>
              <Input
                id="p-documento"
                value={watch('documento') ?? ''}
                onChange={(e) =>
                  setValue('documento', formatarCpfCnpj(e.target.value), {
                    shouldValidate: true,
                  })
                }
                placeholder="000.000.000-00"
              />
              {errors.documento && (
                <p className="text-sm text-destructive">{errors.documento.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-email">
                E-mail <span className="text-destructive">*</span>
              </Label>
              <Input id="p-email" type="email" {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-telefone">Telefone</Label>
              <Input
                id="p-telefone"
                value={watch('telefone') ?? ''}
                onChange={(e) =>
                  setValue('telefone', formatarTelefone(e.target.value), {
                    shouldValidate: true,
                  })
                }
                placeholder="(00) 00000-0000"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-responsavel">Responsável</Label>
              <Input id="p-responsavel" {...register('responsavel')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-status">Status</Label>
              <Select
                value={watch('status')}
                onValueChange={(v) => setValue('status', v as FormData['status'])}
              >
                <SelectTrigger id="p-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                  <SelectItem value="suspenso">Suspenso</SelectItem>
                  <SelectItem value="encerrado">Encerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-janela">Janela de atribuição (dias)</Label>
            <Input
              id="p-janela"
              type="number"
              min={1}
              max={730}
              {...register('janela_atribuicao_dias', { valueAsNumber: true })}
            />
            <p className="text-xs text-muted-foreground">
              Tempo entre o clique no link e o cadastro para o parceiro ainda receber o crédito.
              Vale para atribuições novas; as existentes mantêm a janela com que nasceram.
            </p>
            {errors.janela_atribuicao_dias && (
              <p className="text-sm text-destructive">
                {errors.janela_atribuicao_dias.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-observacoes">Observações internas</Label>
            <Textarea id="p-observacoes" rows={3} {...register('observacoes')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
