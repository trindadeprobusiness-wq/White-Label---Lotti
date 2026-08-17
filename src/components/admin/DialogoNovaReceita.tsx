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
import { useRegistrarReceita, useUsuarios } from '@/hooks/admin/useAdminDados';
import { paraISO } from '@/lib/admin/periodo';
import { moeda } from '@/lib/formato';

interface Props {
  aberto: boolean;
  aoFechar: () => void;
}

const MIN_MOTIVO = 10;

export function DialogoNovaReceita({ aberto, aoFechar }: Props) {
  const registrar = useRegistrarReceita();

  const [busca, setBusca] = useState('');
  const [corretorId, setCorretorId] = useState('');
  const [valor, setValor] = useState('');
  const [confirmadoEm, setConfirmadoEm] = useState(paraISO(new Date()));
  const [tipo, setTipo] = useState('assinatura');
  const [motivo, setMotivo] = useState('');

  // Busca só dispara com 2+ caracteres: carregar a lista inteira de corretores
  // num select não escala e não ajuda quem já sabe o nome.
  const { data: usuarios, isFetching } = useUsuarios({
    busca: busca.trim().length >= 2 ? busca.trim() : undefined,
    pagina: 1,
  });

  useEffect(() => {
    if (!aberto) return;
    setBusca('');
    setCorretorId('');
    setValor('');
    setConfirmadoEm(paraISO(new Date()));
    setTipo('assinatura');
    setMotivo('');
  }, [aberto]);

  const numeroValor = Number(valor.replace(/\./g, '').replace(',', '.'));
  const valorOk = !!valor && !Number.isNaN(numeroValor) && numeroValor > 0;
  const dataOk = !!confirmadoEm && confirmadoEm <= paraISO(new Date());
  const motivoOk = motivo.trim().length >= MIN_MOTIVO;
  const podeSalvar = !!corretorId && valorOk && dataOk && motivoOk;

  const salvar = async () => {
    if (!podeSalvar) return;
    await registrar.mutateAsync({
      corretorId,
      valorBruto: numeroValor,
      // Meio-dia local evita que a data pura vire o dia anterior ao virar UTC.
      confirmadoEm: new Date(`${confirmadoEm}T12:00:00`).toISOString(),
      tipo,
      motivo: motivo.trim(),
    });
    aoFechar();
  };

  const candidatos = usuarios?.itens ?? [];
  const selecionado = candidatos.find((u) => u.corretor_id === corretorId);

  return (
    <Dialog open={aberto} onOpenChange={(e) => !e && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar receita</DialogTitle>
          <DialogDescription>
            Use apenas para pagamento efetivamente confirmado. Se o cliente tiver um parceiro
            com percentual vigente, a comissão é gerada automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rc-busca">Cliente</Label>
            <Input
              id="rc-busca"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setCorretorId('');
              }}
              placeholder="Digite o nome ou e-mail"
              autoFocus
            />
            {busca.trim().length >= 2 && (
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {isFetching && candidatos.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Buscando...</p>
                ) : candidatos.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Nenhuma conta encontrada.</p>
                ) : (
                  candidatos.slice(0, 8).map((u) => (
                    <button
                      key={u.corretor_id}
                      type="button"
                      onClick={() => {
                        setCorretorId(u.corretor_id);
                        setBusca(u.nome);
                      }}
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="font-medium">{u.nome}</span>
                      <span className="text-xs text-muted-foreground">{u.email}</span>
                    </button>
                  ))
                )}
              </div>
            )}
            {selecionado && (
              <p className="text-xs text-success">Selecionado: {selecionado.nome}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rc-valor">Valor recebido (R$)</Label>
            <Input
              id="rc-valor"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="149,00"
            />
            {valorOk && (
              <p className="text-xs text-muted-foreground">{moeda(numeroValor)}</p>
            )}
            {valor && !valorOk && (
              <p className="text-sm text-destructive">Informe um valor maior que zero.</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rc-data">Data da confirmação</Label>
              <Input
                id="rc-data"
                type="date"
                value={confirmadoEm}
                max={paraISO(new Date())}
                onChange={(e) => setConfirmadoEm(e.target.value)}
              />
              {!dataOk && (
                <p className="text-sm text-destructive">A data não pode ser futura.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-tipo">Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger id="rc-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assinatura">Assinatura</SelectItem>
                  <SelectItem value="addon">Adicional</SelectItem>
                  <SelectItem value="avulso">Avulso</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* A data escolhida decide qual percentual vale — não o de hoje. */}
          <p className="text-xs text-muted-foreground">
            A comissão usa o percentual vigente na data da confirmação.
          </p>

          <div className="space-y-2">
            <Label htmlFor="rc-motivo">
              Justificativa <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="rc-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: pagamento PIX confirmado em extrato, comprovante no Drive"
            />
            <p className={motivoOk ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
              {motivoOk
                ? 'Registrado na auditoria com seu usuário e a data.'
                : `Escreva ao menos ${MIN_MOTIVO} caracteres.`}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={registrar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={!podeSalvar || registrar.isPending}>
            {registrar.isPending ? 'Registrando...' : 'Registrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
