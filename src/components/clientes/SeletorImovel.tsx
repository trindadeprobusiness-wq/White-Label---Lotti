import { useState } from 'react';
import { Plus, Building2, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useCRMStore } from '@/stores/crmStore';
import { mensagemDeErro } from '@/lib/errors';
import { moeda } from '@/lib/formato';

/**
 * Escolhe um imóvel — ou cadastra um na hora.
 *
 * Antes, se o imóvel do interesse do cliente ainda não existia, o corretor
 * precisava: cancelar o cadastro do cliente, ir em Imóveis, preencher o
 * formulário completo, voltar e recomeçar. Na prática ele escolhia "Nenhum" e
 * o vínculo se perdia.
 *
 * Aqui o cadastro rápido pede só o que a tabela exige como NOT NULL (título,
 * tipo, valor, endereço, cidade, proprietário). O restante fica em branco de
 * propósito: o imóvel nasce reconhecidamente incompleto e já aparece no card
 * "Imóveis com cadastro incompleto" do Início, que é onde o corretor termina
 * o preenchimento com calma.
 */

const TIPOS = [
  { valor: 'CASA', label: 'Casa' },
  { valor: 'APARTAMENTO', label: 'Apartamento' },
  { valor: 'TERRENO', label: 'Terreno' },
  { valor: 'COMERCIAL', label: 'Comercial' },
  { valor: 'RURAL', label: 'Rural' },
] as const;

/** "R$ 450.000,00" ou "450000" → 450000. */
function paraNumero(bruto: string): number {
  const limpo = bruto.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function SeletorImovel({ value, onChange }: Props) {
  const { imoveis, corretor, fetchImoveis } = useCRMStore();
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<string>('CASA');
  const [valor, setValor] = useState('');
  const [endereco, setEndereco] = useState('');
  const [cidade, setCidade] = useState('');

  const numeroValor = paraNumero(valor);
  const podeSalvar =
    titulo.trim().length >= 3 && endereco.trim().length >= 3 && cidade.trim().length >= 2;

  const limpar = () => {
    setTitulo(''); setTipo('CASA'); setValor(''); setEndereco(''); setCidade('');
  };

  const salvar = async () => {
    if (!podeSalvar || salvando) return;

    if (!corretor?.id) {
      toast.error('Sua conta ainda está carregando. Tente novamente em instantes.');
      return;
    }

    setSalvando(true);
    try {
      const { data, error } = await supabase
        .from('imoveis')
        .insert({
          corretor_id: corretor.id,
          titulo: titulo.trim(),
          tipo: tipo as never,
          // Valor 0 é aceito: nem todo imóvel tem preço definido no momento em
          // que o cliente demonstra interesse. É o que o Início sinaliza como
          // cadastro incompleto.
          valor: numeroValor,
          endereco: endereco.trim(),
          cidade: cidade.trim(),
          proprietario_nome: 'A definir',
          ativo: true,
        })
        .select('id, titulo')
        .single();

      if (error) throw error;

      await fetchImoveis();
      onChange(data.id);
      limpar();
      setCriando(false);
      toast.success('Imóvel cadastrado e vinculado.', {
        description: 'Complete os demais dados depois, em Imóveis.',
      });
    } catch (e) {
      toast.error(mensagemDeErro(e, 'Não foi possível cadastrar o imóvel.'));
    } finally {
      setSalvando(false);
    }
  };

  if (criando) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4 text-primary" />
            Novo imóvel
          </p>
          <Button
            type="button" variant="ghost" size="icon" className="h-8 w-8"
            onClick={() => { setCriando(false); limpar(); }}
            aria-label="Cancelar cadastro de imóvel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ri-titulo" className="text-xs">
            Título <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ri-titulo" value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Sobrado com 3 suítes"
            autoFocus
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ri-tipo" className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger id="ri-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ri-valor" className="text-xs">Valor</Label>
            <Input
              id="ri-valor" inputMode="decimal" value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="450.000,00"
            />
            {numeroValor > 0 && (
              <p className="text-xs text-muted-foreground">{moeda(numeroValor)}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ri-endereco" className="text-xs">
            Endereço <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ri-endereco" value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            placeholder="Rua, número"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ri-cidade" className="text-xs">
            Cidade <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ri-cidade" value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            placeholder="Anápolis"
          />
        </div>

        {/* type="button" é essencial: dentro do <form> do cliente, um submit
            aqui enviaria o formulário do cliente pela metade. */}
        <Button
          type="button" className="w-full"
          onClick={() => void salvar()}
          disabled={!podeSalvar || salvando}
        >
          {salvando ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cadastrando...</>
          ) : (
            'Cadastrar e vincular'
          )}
        </Button>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Só o essencial agora. O imóvel aparecerá em “cadastros incompletos” no
          Início até você preencher o restante.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Selecione..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Nenhum</SelectItem>
          {imoveis.map((imovel) => (
            <SelectItem key={imovel.id} value={imovel.id}>
              {imovel.titulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button" variant="ghost" size="sm"
        className="h-8 w-full justify-start text-primary hover:bg-surface-brand"
        onClick={() => setCriando(true)}
      >
        <Plus className="mr-1.5 h-4 w-4" />
        Cadastrar novo imóvel
      </Button>
    </div>
  );
}
