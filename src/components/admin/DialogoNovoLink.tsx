import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useCriarLink } from '@/hooks/admin/useAdminDados';
import { getParceiroLinkUrl } from '@/lib/publicBaseUrl';

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  parceiroId: string;
  temPrincipal: boolean;
}

/**
 * Normaliza para o formato aceito pelo CHECK de parceiro_links e por
 * slugValido() na Edge Function: minúsculo, sem acento, hífen no meio.
 * As três definições precisam concordar — se divergirem, o link é aceito aqui
 * e recusado no INSERT.
 */
// Faixa de diacríticos combinantes (U+0300–U+036F), montada só com ASCII para
// não depender do encoding deste arquivo sobreviver a edições.
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizarSlug(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function DialogoNovoLink({ aberto, aoFechar, parceiroId, temPrincipal }: Props) {
  const criar = useCriarLink();
  const [slug, setSlug] = useState('');
  const [campanha, setCampanha] = useState('');
  const [principal, setPrincipal] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setSlug('');
    setCampanha('');
    setPrincipal(!temPrincipal); // o primeiro link vira o principal por padrão
  }, [aberto, temPrincipal]);

  const normalizado = normalizarSlug(slug);
  const valido = normalizado.length >= 3;

  const salvar = async () => {
    if (!valido) return;
    await criar.mutateAsync({
      parceiroId,
      slug: normalizado,
      campanha: campanha.trim() || null,
      principal,
    });
    aoFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(e) => !e && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gerar link exclusivo</DialogTitle>
          <DialogDescription>
            O identificador entra na URL e é lido em voz alta ao telefone — prefira algo curto
            e sem ambiguidade.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="link-slug">Identificador</Label>
            <Input
              id="link-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="imobiliaria-x"
              autoFocus
            />
            {normalizado && (
              <div className="rounded-md border bg-muted/40 p-2">
                <p className="text-xs text-muted-foreground">O link ficará assim:</p>
                <code className="break-all text-sm">{getParceiroLinkUrl(normalizado)}</code>
              </div>
            )}
            {slug && !valido && (
              <p className="text-sm text-destructive">
                Use ao menos 3 caracteres entre letras, números e hífen.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="link-campanha">Campanha (opcional)</Label>
            <Input
              id="link-campanha"
              value={campanha}
              onChange={(e) => setCampanha(e.target.value)}
              placeholder="Ex: newsletter de agosto"
            />
            <p className="text-xs text-muted-foreground">
              Serve para separar resultados de ações diferentes do mesmo parceiro.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="pr-4">
              <Label htmlFor="link-principal" className="cursor-pointer">
                Link principal
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {temPrincipal
                  ? 'Marcar aqui exige revogar o link principal atual antes.'
                  : 'Este parceiro ainda não tem um link principal.'}
              </p>
            </div>
            <Switch
              id="link-principal"
              checked={principal}
              onCheckedChange={setPrincipal}
              disabled={temPrincipal}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={!valido || criar.isPending}>
            {criar.isPending ? 'Gerando...' : 'Gerar link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
