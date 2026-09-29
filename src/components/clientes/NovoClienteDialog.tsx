import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCRMStore } from '@/stores/crmStore';
import { TipoInteresse, StatusFunil, Cliente } from '@/types/crm';
import { useToast } from '@/hooks/use-toast';
import { getTrackingData } from '@/hooks/useUTMTracker';
// A máscara local truncava a string JÁ formatada (slice(0,15)) sem limitar os
// dígitos antes: colar "5562999998888" virava "(55) 6299999-88". Esta corta em
// 11 dígitos primeiro e é a mesma usada no resto do app.
import { formatarTelefone } from '@/lib/validators';
import { SeletorImovel } from './SeletorImovel';
import type { CandidatoCliente } from '@/lib/crm/duplicidade';

interface NovoClienteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteToEdit?: Cliente | null;
  /**
   * Quem abriu o cadastro no meio de outro fluxo (ex.: novo contrato) usa o
   * cliente que já tem o telefone em vez de sair da tela para abri-lo.
   */
  onUsarExistente?: (clienteId: string) => void;
}

export function NovoClienteDialog({ open, onOpenChange, clienteToEdit, onUsarExistente }: NovoClienteDialogProps) {
  const { addCliente, updateCliente, imoveis, fetchImoveis, vincularClienteImovel } = useCRMStore();
  const { toast } = useToast();
  const navigate = useNavigate();
  // A conta não pode ter dois clientes com o mesmo telefone. Quando o banco
  // recusa, mostramos quem já tem o número; não há "criar mesmo assim".
  const [duplicados, setDuplicados] = useState<CandidatoCliente[]>([]);
  const [form, setForm] = useState({
    nome: '',
    telefone: '',
    email: '',
    tipo_interesse: 'COMPRA' as TipoInteresse,
    observacoes: ''
  });
  const [selectedImovel, setSelectedImovel] = useState<string>('');

  useEffect(() => {
    if (open) {
      fetchImoveis();
      if (clienteToEdit) {
        setForm({
          nome: clienteToEdit.nome,
          telefone: clienteToEdit.telefone,
          email: clienteToEdit.email || '',
          tipo_interesse: clienteToEdit.tipo_interesse,
          observacoes: clienteToEdit.observacoes || '',
        });
        // Pre-select the linked property if exists
        setSelectedImovel(clienteToEdit.imoveis_interesse?.[0] || '');
      } else {
        setForm({ nome: '', telefone: '', email: '', tipo_interesse: 'COMPRA', observacoes: '' });
        setSelectedImovel('');
      }
      setDuplicados([]);
    }
  }, [open, clienteToEdit]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);

    // Custom Email Validation
    if (form.email && !form.email.includes('@')) {
      toast({
        variant: "destructive",
        title: "Email inválido",
        description: "Por favor, insira um endereço de email válido contendo '@'."
      });
      setIsSubmitting(false);
      return;
    }

    try {
      if (clienteToEdit) {
        const resultado = await updateCliente(clienteToEdit.id, form);
        if (resultado.status === 'duplicate') { setDuplicados(resultado.candidatos); return; }
        if (resultado.status !== 'updated') return; // o store já exibiu o toast de erro
        if (selectedImovel) {
          await vincularClienteImovel(clienteToEdit.id, selectedImovel);
        }
        toast({ title: 'Cliente atualizado com sucesso!' });
      } else {
        const trackingData = getTrackingData();
        const resultado = await addCliente({
          ...form,
          status_funil: 'QUALIFICACAO' as StatusFunil,
          ultimo_contato: new Date().toISOString(),
          tracking_data: trackingData || {}
        });

        if (resultado.status === 'duplicate') { setDuplicados(resultado.candidatos); return; }
        if (resultado.status !== 'created') return; // o store já exibiu o toast de erro

        if (selectedImovel) {
          await vincularClienteImovel(resultado.id, selectedImovel);
        }

        toast({ title: 'Cliente cadastrado com sucesso!' });
      }

      onOpenChange(false);
    } catch (error) {
      console.error("Erro ao salvar:", error);
      toast({ variant: "destructive", title: "Erro ao salvar" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{clienteToEdit ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
          <DialogDescription>
            {clienteToEdit ? 'Atualize os dados do cliente abaixo.' : 'Preencha os dados para cadastrar um novo cliente.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><Label>Nome *</Label><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
          <div>
            <Label>Telefone *</Label>
            <Input
              required
              value={form.telefone}
              onChange={(e) => { setForm({ ...form, telefone: formatarTelefone(e.target.value) }); setDuplicados([]); }}
              placeholder="(00) 00000-0000"
              maxLength={15}
            />
          </div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="exemplo@email.com" /></div>

          <div className="grid grid-cols-2 gap-4">
            <div><Label>Interesse</Label>
              <Select value={form.tipo_interesse} onValueChange={(v) => setForm({ ...form, tipo_interesse: v as TipoInteresse })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPRA">Compra</SelectItem>
                  <SelectItem value="LOCACAO">Locação</SelectItem>
                  <SelectItem value="AMBOS">Ambos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Imóvel de Interesse</Label>
              {/* Permite cadastrar o imóvel sem sair do cadastro do cliente —
                  antes era preciso cancelar tudo, ir em Imóveis e recomeçar. */}
              <SeletorImovel value={selectedImovel} onChange={setSelectedImovel} />
            </div>
          </div>

          <div><Label>Observações</Label><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>

          {duplicados.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                {duplicados[0].nome ? `Este telefone já é do cliente ${duplicados[0].nome}` : 'Este telefone já é de outro cliente'}
              </p>
              <p className="text-xs text-muted-foreground">
                Cada telefone pertence a um único cliente. Abra o cadastro existente ou corrija o número.
              </p>
              {duplicados.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{c.nome || 'Cliente já cadastrado'}</span>
                  {onUsarExistente && (
                    <Button type="button" size="sm" onClick={() => { onUsarExistente(c.id); onOpenChange(false); }}>
                      Usar este cliente
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" onClick={() => { onOpenChange(false); navigate(`/clientes/${c.id}`); }}>
                    Abrir
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting || duplicados.length > 0}>
            {isSubmitting ? 'Salvando...' : (clienteToEdit ? 'Salvar Alterações' : 'Cadastrar')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
