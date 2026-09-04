import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useRegistrarCancelamento } from '@/hooks/admin/useSaasDados';
import { useUsuarios } from '@/hooks/admin/useAdminDados';
import { MOTIVOS, ORIGENS } from '@/lib/admin/saas';
import { paraISO } from '@/lib/admin/periodo';

const SEM_CONTA = 'SEM_CONTA';

/**
 * Registro de um cancelamento.
 *
 * A conta é escolhida por busca, não digitada. Quando ela existe, nome,
 * telefone e e-mail NÃO são gravados de novo: o servidor os descarta e a
 * listagem os traz do cadastro. Repetir dado pessoal aqui criaria uma segunda
 * cópia para manter atualizada e para localizar num pedido de exclusão.
 */
export function DialogoNovoCancelamento({
  aberto,
  aoFechar,
}: {
  aberto: boolean;
  aoFechar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [corretorId, setCorretorId] = useState(SEM_CONTA);
  const [motivo, setMotivo] = useState('');
  const [origem, setOrigem] = useState('whatsapp');
  const [comentario, setComentario] = useState('');
  const [data, setData] = useState(() => paraISO(new Date()));
  const [nome, setNome] = useState('');

  const registrar = useRegistrarCancelamento();
  // Só consulta quando há o que buscar: abrir o diálogo não deve puxar a base
  // inteira de contas.
  const contas = useUsuarios({ busca: busca.trim() || undefined, pagina: 1 });

  useEffect(() => {
    if (aberto) {
      setBusca('');
      setCorretorId(SEM_CONTA);
      setMotivo('');
      setOrigem('whatsapp');
      setComentario('');
      setNome('');
      setData(paraISO(new Date()));
    }
  }, [aberto]);

  const identificada = corretorId !== SEM_CONTA;
  const podeSalvar = !!motivo && (identificada || nome.trim().length >= 2);

  const salvar = async () => {
    if (!podeSalvar) return;
    await registrar.mutateAsync({
      motivo,
      corretorId: identificada ? corretorId : null,
      contatoNome: identificada ? undefined : nome.trim(),
      comentario: comentario.trim() || undefined,
      origem,
      data,
    });
    aoFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(e) => !e && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar cancelamento</DialogTitle>
          <DialogDescription>
            O motivo é obrigatório. O comentário deve trazer as palavras do cliente, não
            a interpretação de quem registra.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-busca">Buscar conta</Label>
            <Input
              id="cancel-busca"
              placeholder="Nome ou e-mail da conta Lotti"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-conta">Conta</Label>
            <Select value={corretorId} onValueChange={setCorretorId}>
              <SelectTrigger id="cancel-conta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_CONTA}>Sem conta identificada</SelectItem>
                {(contas.data?.itens ?? []).map((c) => (
                  <SelectItem key={c.corretor_id} value={c.corretor_id}>
                    {c.nome} — {c.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {identificada && (
              <p className="text-xs text-muted-foreground">
                Contato e plano anterior são lidos do cadastro; não é preciso digitá-los.
              </p>
            )}
          </div>

          {!identificada && (
            <div className="space-y-1.5">
              <Label htmlFor="cancel-nome">
                Nome do contato <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cancel-nome"
                placeholder="Quem cancelou"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cancel-motivo">
                Motivo <span className="text-destructive">*</span>
              </Label>
              <Select value={motivo} onValueChange={setMotivo}>
                <SelectTrigger id="cancel-motivo">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVOS.map((m) => (
                    <SelectItem key={m.valor} value={m.valor}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cancel-origem">Origem</Label>
              <Select value={origem} onValueChange={setOrigem}>
                <SelectTrigger id="cancel-origem">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIGENS.map((o) => (
                    <SelectItem key={o.valor} value={o.valor}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-data">Data do cancelamento</Label>
            <Input
              id="cancel-data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-comentario">Comentário</Label>
            <Textarea
              id="cancel-comentario"
              rows={3}
              placeholder="O que o cliente disse, nas palavras dele."
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
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
