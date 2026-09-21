import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAsaasConnection } from '@/hooks/useAsaasConnection';

interface Props {
  compacto?: boolean;
  onStatusChange?: (conectada: boolean) => void;
}

function dataHora(valor: string | null): string | null {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(data);
}

export function AsaasConnectionPanel({ compacto = false, onStatusChange }: Props) {
  const { conexao, disponivel, carregando, erro, recarregar, conectar, desconectar } = useAsaasConnection();
  const [apiKey, setApiKey] = useState('');
  const [ambiente, setAmbiente] = useState<'sandbox' | 'producao'>('producao');
  const [mostrarChave, setMostrarChave] = useState(false);
  const [trocarChave, setTrocarChave] = useState(false);

  const conectada = conexao?.status === 'conectada' || conexao?.status === 'sem_permissao';
  const mostrarFormulario = !conectada || trocarChave;

  useEffect(() => {
    onStatusChange?.(conectada);
  }, [conectada, onStatusChange]);

  const salvar = async () => {
    if (!apiKey.trim()) {
      toast.error('Cole a chave de API criada na sua conta Asaas.');
      return;
    }
    try {
      const resultado = await conectar.mutateAsync({ apiKey, ambiente });
      setApiKey('');
      setMostrarChave(false);
      setTrocarChave(false);
      if (resultado.aviso) toast.warning(resultado.aviso);
      toast.success('Conta Asaas conectada e webhook configurado.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível conectar a conta Asaas.');
    }
  };

  const remover = async () => {
    try {
      const resultado = await desconectar.mutateAsync();
      setApiKey('');
      setTrocarChave(false);
      if (resultado.aviso) toast.warning(resultado.aviso);
      toast.success('Conta Asaas desconectada da Lotti.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível desconectar a conta Asaas.');
    }
  };

  if (carregando) {
    return (
      <Card><CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />Verificando sua conexão Asaas...
      </CardContent></Card>
    );
  }

  if (!disponivel) {
    return (
      <Alert>
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>Integração aguardando ativação</AlertTitle>
        <AlertDescription>
          A tela já está pronta, mas a atualização segura do banco e a função de conexão ainda precisam ser publicadas.
        </AlertDescription>
      </Alert>
    );
  }

  if (erro) {
    return (
      <Alert variant="destructive">
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>Não foi possível consultar a conexão</AlertTitle>
        <AlertDescription className="mt-2">
          Tente novamente. Nenhum saldo ou dado de outra conta será exibido enquanto a origem não puder ser confirmada.
          <Button variant="outline" size="sm" className="mt-3 block" onClick={() => void recarregar()}>Tentar novamente</Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {conectada && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardHeader className={compacto ? 'pb-3' : undefined}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  {conexao?.conta_nome || 'Conta Asaas conectada'}
                </CardTitle>
                <CardDescription className="mt-1">
                  {conexao?.herdada_do_ambiente ? 'Conta principal preservada na migração segura.' : 'Credencial própria desta operação.'}
                </CardDescription>
              </div>
              <Badge variant="outline" className="w-fit border-emerald-300 bg-white text-emerald-800">
                {conexao?.ambiente === 'sandbox' ? 'Sandbox' : 'Produção'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg border bg-white/80 p-3">
                <p className="text-xs text-muted-foreground">Chave armazenada</p>
                <p className="mt-1 font-medium">•••• {conexao?.chave_final || 'protegida no servidor'}</p>
              </div>
              <div className="rounded-lg border bg-white/80 p-3">
                <p className="text-xs text-muted-foreground">Webhook</p>
                <p className="mt-1 font-medium">{conexao?.webhook_configurado_em ? 'Configurado automaticamente' : 'Aguardando configuração'}</p>
              </div>
            </div>
            {dataHora(conexao?.validada_em ?? null) && (
              <p className="text-xs text-muted-foreground">Última validação: {dataHora(conexao?.validada_em ?? null)}</p>
            )}
            {conexao?.status === 'sem_permissao' && (
              <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>Saldo sem permissão de leitura</AlertTitle>
                <AlertDescription>
                  As cobranças continuam isoladas nesta conta. Para mostrar o saldo, crie outra chave com leitura de dados financeiros e conecte novamente.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setTrocarChave((valor) => !valor)}>
                <KeyRound className="mr-2 h-4 w-4" />{trocarChave ? 'Cancelar troca' : 'Trocar chave'}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="text-destructive hover:text-destructive">
                    <Unplug className="mr-2 h-4 w-4" />Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar esta conta Asaas?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A Lotti deixará de emitir cobranças e consultar saldo até uma conta ser conectada novamente. Cobranças já emitidas não serão apagadas no Asaas.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Manter conectada</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void remover()} disabled={desconectar.isPending}>Desconectar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {mostrarFormulario && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlugZap className="h-5 w-5" />
              {conectada ? 'Conectar uma nova chave' : 'Conectar sua conta Asaas'}
            </CardTitle>
            <CardDescription>
              Você faz tudo por aqui. A equipe da Lotti não precisa receber nem configurar sua chave.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ol className="space-y-3 text-sm leading-6 text-muted-foreground">
              <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">1</span><span>No Asaas, abra <strong className="text-foreground">Integrações → Chaves de API</strong> e crie uma chave exclusiva para a Lotti.</span></li>
              <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">2</span><span>Libere leitura e escrita de <strong className="text-foreground">clientes, cobranças e webhooks</strong>. Libere leitura de dados financeiros para exibir o saldo.</span></li>
              <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">3</span><span>Cole a chave abaixo. A Lotti valida a conta, cifra a chave e configura o webhook automaticamente.</span></li>
            </ol>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href="https://www.asaas.com/" target="_blank" rel="noreferrer">Abrir Asaas<ExternalLink className="ml-2 h-4 w-4" /></a>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <a href="https://docs.asaas.com/docs/chaves-de-api" target="_blank" rel="noreferrer">Como criar a chave<ExternalLink className="ml-2 h-4 w-4" /></a>
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-2">
                <Label htmlFor="asaas-api-key">Chave de API</Label>
                <div className="relative">
                  <Input
                    id="asaas-api-key"
                    type={mostrarChave ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="$aact_..."
                    className="pr-11"
                  />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setMostrarChave((valor) => !valor)} aria-label={mostrarChave ? 'Ocultar chave' : 'Mostrar chave'}>
                    {mostrarChave ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="asaas-ambiente">Ambiente</Label>
                <Select value={ambiente} onValueChange={(valor) => setAmbiente(valor as 'sandbox' | 'producao')}>
                  <SelectTrigger id="asaas-ambiente"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="producao">Produção</SelectItem>
                    <SelectItem value="sandbox">Sandbox</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Alert className="border-primary/20 bg-primary/[0.03]">
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Segredo protegido</AlertTitle>
              <AlertDescription>
                A chave é enviada somente para a função segura, armazenada com AES-256-GCM e nunca volta para esta tela. A Lotti mostra apenas os quatro últimos caracteres.
              </AlertDescription>
            </Alert>

            <Button onClick={() => void salvar()} disabled={!apiKey.trim() || conectar.isPending} className="w-full sm:w-auto">
              {conectar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
              Validar e conectar conta
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
