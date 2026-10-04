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
import { useCriarParceiroConvidar, useSalvarParceiro } from '@/hooks/admin/useAdminDados';
import { validarCPF, validarCNPJ, formatarCpfCnpj, formatarTelefone } from '@/lib/validators';
import type { Parceiro } from '@/integrations/supabase/admin-types';
import { toast } from 'sonner';
import { mensagemDeErro } from '@/lib/errors';

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
  percentual: z.number().min(0).max(100),
  renovacoes: z.enum(['receita_bruta', 'primeiro_pagamento']),
  teto_renovacoes: z.number().int().min(0).nullable(),
  slug: z.string(),
  campanha: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  parceiro?: Parceiro | null;
}

export function FormularioParceiro({ aberto, aoFechar, parceiro }: Props) {
  const salvar = useSalvarParceiro();
  const criarEConvidar = useCriarParceiroConvidar();
  const editando = !!parceiro;

  const {
    register, handleSubmit, reset, setValue, watch, setError,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<FormData>({
    resolver: zodResolver(schema.superRefine((dados, ctx) => {
      if (!editando && !/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(dados.slug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slug'], message: 'Identificador inválido' });
      }
    })),
    defaultValues: {
      nome: '', email: '', status: 'ativo', janela_atribuicao_dias: 90,
      percentual: 10, renovacoes: 'receita_bruta', teto_renovacoes: null, slug: '',
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
      percentual: 10, renovacoes: 'receita_bruta', teto_renovacoes: null,
      slug: parceiro?.nome?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-') ?? '',
      campanha: '',
    });
  }, [aberto, parceiro, reset]);

  const aoSalvar = async (dados: FormData) => {
    if (!editando) {
      const resultado = await criarEConvidar.mutateAsync({
        parceiro: {
          nome: dados.nome.trim(), empresa: dados.empresa?.trim() || null,
          documento: dados.documento?.replace(/\D/g, '') || null,
          email: dados.email.trim().toLowerCase(), telefone: dados.telefone?.trim() || null,
          responsavel: dados.responsavel?.trim() || null,
          janela_atribuicao_dias: dados.janela_atribuicao_dias,
          observacoes: dados.observacoes?.trim() || null,
        },
        comissao: { percentual: dados.percentual, base_calculo: dados.renovacoes,
          teto_renovacoes: dados.renovacoes === 'receita_bruta' ? dados.teto_renovacoes : 0 },
        link: { slug: dados.slug, campanha: dados.campanha?.trim() || null },
      });
      if (resultado.email_enviado === false) toast.warning(resultado.error ?? 'Cadastro salvo. Confira o envio do convite no cadastro do parceiro.');
      else toast.success(`Convite enviado para ${dados.email.trim().toLowerCase()}.`);
      aoFechar();
      return;
    }
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
    <Dialog open={aberto} onOpenChange={(e) => !e && !isSubmitting && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar parceiro' : 'Novo parceiro'}</DialogTitle>
          <DialogDescription>
            {editando
              ? 'Alterações de cadastro não afetam comissões já geradas.'
              : 'O cadastro, a comissão, o link exclusivo e o convite por e-mail serão criados juntos.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(async (dados) => {
          try { await aoSalvar(dados); }
          catch (erro) { setError('root', { message: mensagemDeErro(erro, 'Não foi possível salvar. Tente novamente.') }); }
        })} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="p-nome">
              Nome <span className="text-destructive">*</span>
            </Label>
            <Input id="p-nome" {...register('nome', { onChange: (event) => {
              if (!editando && !dirtyFields.slug) setValue('slug', event.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 48).replace(/^-|-$/g, ''));
            } })} placeholder="Nome do parceiro" />
            {errors.nome && <p className="text-sm text-destructive">{errors.nome.message}</p>}
          </div>

          {!editando && <div className="space-y-4 rounded-md border p-4">
            <h3 className="text-sm font-semibold">Acesso e condições do parceiro</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="p-percentual">Comissão (%)</Label>
                <Input id="p-percentual" type="number" min="0" max="100" step="0.01" {...register('percentual', { valueAsNumber: true })} />
                {errors.percentual && <p className="text-sm text-destructive">Use um percentual entre 0 e 100.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-renovacoes">Comissão em renovações</Label>
                <Select value={watch('renovacoes')} onValueChange={(v) => setValue('renovacoes', v as FormData['renovacoes'])}>
                  <SelectTrigger id="p-renovacoes"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receita_bruta">Sim, recorrente</SelectItem>
                    <SelectItem value="primeiro_pagamento">Não, somente a primeira venda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {watch('renovacoes') === 'receita_bruta' && <div className="space-y-2">
              <Label htmlFor="p-teto">Teto de renovações</Label>
              <Input id="p-teto" type="number" min="0" placeholder="Sem limite" {...register('teto_renovacoes', { setValueAs: (v) => v == null || v === '' ? null : Number(v) })} />
              {errors.teto_renovacoes && <p className="text-sm text-destructive">Informe um número inteiro maior ou igual a zero.</p>}
              <p className="text-xs text-muted-foreground">Deixe vazio para comissão recorrente sem limite.</p>
            </div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="p-slug">Identificador do link</Label>
                <Input id="p-slug" {...register('slug')} placeholder="nome-do-parceiro" />
                {errors.slug && <p className="text-sm text-destructive">Use letras minúsculas, números e hífen (3 a 48 caracteres).</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-campanha">Campanha (opcional)</Label>
                <Input id="p-campanha" {...register('campanha')} placeholder="Ex.: lançamento" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">O parceiro receberá por e-mail o link e os termos. Ele define a própria senha ao entrar.</p>
          </div>}

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
            {editando && <div className="space-y-2">
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
            </div>}
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

          {errors.root && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (editando ? 'Salvando...' : 'Criando e enviando...') : (editando ? 'Salvar' : 'Criar parceiro e enviar convite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
