import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, Copy, ExternalLink, ImagePlus, Loader2,
  Sparkles, Trash2, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { QrCodePositioner } from './QrCodePositioner';
import { useCRMStore } from '@/stores/crmStore';
import { useFileDrop } from '@/hooks/useFileDrop';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  AREAS_QR, BRIEFING_PADRAO, DESTAQUES_DISPONIVEIS, DESTINOS_IA, ESTILOS,
  FORMATOS, OBJETIVOS, linkParaIA, montarPromptTemplate, sugerirNome,
  type AreaQr, type BriefingTemplate, type DestaqueArte, type DestinoIA,
  type EstiloArte, type FormatoArte, type ObjetivoArte,
} from '@/lib/fachadas/promptTemplate';

export interface DadosNovoTemplate {
  nome: string;
  arquivo: File;
  qrPosition: { x: number; y: number };
  qrSize: number;
}

interface AssistenteTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  salvando?: boolean;
  onSalvar: (dados: DadosNovoTemplate) => Promise<void>;
}

type Passo = 'briefing' | 'prompt' | 'arte';

const PASSOS: { id: Passo; rotulo: string; resumo: string }[] = [
  { id: 'briefing', rotulo: 'Briefing', resumo: 'Responda o que precisa' },
  { id: 'prompt', rotulo: 'Prompt', resumo: 'Leve para o gerador' },
  { id: 'arte', rotulo: 'Arte', resumo: 'Suba e posicione o QR' },
];

/* ── Peças visuais ──────────────────────────────────────────────────────── */

function Grupo({
  titulo, descricao, children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
        {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Botão de escolha. Existe em vez de `<Select>` porque o corretor decide
 * comparando as opções lado a lado — dentro de um select ele teria de abrir,
 * ler e fechar sete vezes para escolher um formato de placa.
 */
function Escolha({
  ativo, onClick, titulo, apoio, className,
}: {
  ativo: boolean;
  onClick: () => void;
  titulo: string;
  apoio?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'rounded-lg border px-3 py-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        ativo
          ? 'border-primary bg-surface-brand'
          : 'border-border bg-card hover:border-border-strong',
        className,
      )}
    >
      <span className={cn('block text-sm font-medium leading-tight',
        ativo ? 'text-foreground' : 'text-muted-foreground')}
      >
        {titulo}
      </span>
      {apoio && <span className="mt-0.5 block text-xs text-muted-foreground">{apoio}</span>}
    </button>
  );
}

/* ── Assistente ─────────────────────────────────────────────────────────── */

export function AssistenteTemplateDialog({
  open, onOpenChange, salvando = false, onSalvar,
}: AssistenteTemplateDialogProps) {
  const { corretor } = useCRMStore();

  const [passo, setPasso] = useState<Passo>('briefing');
  const [briefing, setBriefing] = useState<BriefingTemplate>(BRIEFING_PADRAO);
  const [promptEditado, setPromptEditado] = useState<string | null>(null);
  const [destino, setDestino] = useState<DestinoIA>('CHATGPT');
  const [copiado, setCopiado] = useState(false);
  const [marcaAberta, setMarcaAberta] = useState(false);

  const [nome, setNome] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [qrPosition, setQrPosition] = useState({ x: 76, y: 78 });
  const [qrSize, setQrSize] = useState(25);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  const indiceAtual = PASSOS.findIndex((p) => p.id === passo);

  const alterar = <C extends keyof BriefingTemplate>(campo: C, valor: BriefingTemplate[C]) =>
    setBriefing((b) => ({ ...b, [campo]: valor }));

  /* Pré-preenche a marca com o que o corretor já cadastrou. Fazer ele digitar
     de novo o próprio telefone é o tipo de atrito que faz abandonar a tela.
     Acontece uma vez por abertura: o `corretor` do store pode chegar depois
     (ou trocar de identidade a cada atualização), e sem a trava um campo que o
     corretor apagou de propósito voltaria sozinho. */
  const marcaPreenchida = useRef(false);
  useEffect(() => {
    if (!open) {
      marcaPreenchida.current = false;
      return;
    }
    if (!corretor || marcaPreenchida.current) return;
    marcaPreenchida.current = true;
    setBriefing((b) => ({
      ...b,
      empresa: b.empresa || corretor.razao_social || corretor.nome || '',
      telefone: b.telefone || corretor.telefone || '',
      creci: b.creci
        || [corretor.creci, corretor.creci_estado].filter(Boolean).join('-')
        || '',
      site: b.site || corretor.website || '',
    }));
  }, [open, corretor]);

  const promptGerado = useMemo(() => montarPromptTemplate(briefing), [briefing]);
  /* O corretor pode ajustar o texto à mão; enquanto não ajustar, o prompt
     acompanha o briefing em tempo real. */
  const prompt = promptEditado ?? promptGerado;

  const limpar = () => {
    setPasso('briefing');
    setBriefing(BRIEFING_PADRAO);
    setPromptEditado(null);
    setCopiado(false);
    setMarcaAberta(false);
    setNome('');
    setArquivo(null);
    // Revoga fora do setState: um updater pode ser chamado duas vezes em
    // StrictMode, e efeito colateral não pertence a ele.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setQrPosition({ x: 76, y: 78 });
    setQrSize(25);
  };

  const irParaArte = () => {
    const area = AREAS_QR[briefing.areaQr];
    setQrPosition(area.posicao);
    setQrSize(briefing.tamanhoQr);
    setNome((n) => n || sugerirNome(briefing));
    setPasso('arte');
  };

  const copiarPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      return true;
    } catch {
      // A área de transferência exige contexto seguro (https) e pode ser negada.
      toast({
        variant: 'destructive',
        title: 'Não foi possível copiar',
        description: 'Selecione o texto do prompt e copie manualmente.',
      });
      return false;
    }
  };

  const abrirNoChat = async () => {
    const { url, nome: nomeIA, promptNaUrl } = linkParaIA(destino, prompt);
    const foiCopiado = await copiarPrompt();
    // noopener/noreferrer: sem eles a aba aberta ganha referência a esta janela.
    window.open(url, '_blank', 'noopener,noreferrer');
    toast({
      title: `${nomeIA} aberto em outra aba`,
      description: promptNaUrl
        ? `O prompt vai na abertura. Se o chat abrir vazio, ${foiCopiado ? 'é só colar' : 'volte e use "Copiar prompt"'}.`
        : `Cole o prompt no chat${foiCopiado ? ' — ele já está copiado' : ' usando o botão "Copiar prompt"'}.`,
    });
  };

  const selecionarArquivo = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({
        variant: 'destructive',
        title: 'Formato inválido',
        description: 'Envie uma imagem PNG, JPG ou WebP.',
      });
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setArquivo(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const { dragActive, dropProps } = useFileDrop((files) => selecionarArquivo(files[0]), {
    accept: 'image/*',
    onReject: () => toast({
      variant: 'destructive',
      title: 'Formato inválido',
      description: 'Envie uma imagem PNG, JPG ou WebP.',
    }),
  });

  const salvar = async () => {
    if (!arquivo || !nome.trim()) return;
    await onSalvar({ nome: nome.trim(), arquivo, qrPosition, qrSize });
  };

  const alternarDestaque = (item: DestaqueArte) =>
    setBriefing((b) => ({
      ...b,
      destaques: b.destaques.includes(item)
        ? b.destaques.filter((d) => d !== item)
        : [...b.destaques, item],
    }));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) limpar();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Criar meu template
          </DialogTitle>
          <DialogDescription>
            Responda o briefing e o sistema escreve o pedido pronto para um gerador de
            imagem. Depois é só trazer a arte de volta e marcar onde entra o QR Code.
          </DialogDescription>
        </DialogHeader>

        {/* Trilha dos passos. Volta é permitida, pular não. */}
        <nav aria-label="Etapas" className="grid grid-cols-3 gap-2 pb-1">
          {PASSOS.map((p, i) => (
            <button
              key={p.id}
              type="button"
              disabled={i > indiceAtual}
              onClick={() => setPasso(p.id)}
              aria-current={i === indiceAtual ? 'step' : undefined}
              className="group text-left disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              <span
                className={cn(
                  'block h-0.5 rounded-full transition-colors',
                  i <= indiceAtual ? 'bg-primary' : 'bg-border',
                )}
              />
              <span
                className={cn(
                  'mt-2 block text-sm font-medium',
                  i === indiceAtual ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {p.rotulo}
              </span>
              <span className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
                {p.resumo}
              </span>
            </button>
          ))}
        </nav>

        {/* ── Passo 1: briefing ────────────────────────────────────────── */}
        {passo === 'briefing' && (
          <div className="space-y-6">
            <Grupo titulo="Onde essa arte vai ser usada?">
              <div className="grid gap-2 sm:grid-cols-3">
                {FORMATOS.map((f) => (
                  <Escolha
                    key={f.id}
                    ativo={briefing.formato === f.id}
                    onClick={() => alterar('formato', f.id as FormatoArte)}
                    titulo={f.nome}
                    apoio={f.uso}
                  />
                ))}
              </div>
            </Grupo>

            <Grupo titulo="O que você está anunciando?">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(OBJETIVOS) as ObjetivoArte[]).map((id) => (
                  <Escolha
                    key={id}
                    ativo={briefing.objetivo === id}
                    onClick={() => alterar('objetivo', id)}
                    titulo={OBJETIVOS[id].nome}
                  />
                ))}
              </div>
            </Grupo>

            <Grupo titulo="Que cara ela deve ter?">
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(ESTILOS) as EstiloArte[]).map((id) => (
                  <Escolha
                    key={id}
                    ativo={briefing.estilo === id}
                    onClick={() => alterar('estilo', id)}
                    titulo={ESTILOS[id].nome}
                  />
                ))}
              </div>
            </Grupo>

            <Grupo
              titulo="Onde entra o QR Code?"
              descricao="O gerador deixa esse espaço vazio. O QR real do imóvel entra depois, quando você criar a fachada."
            >
              <div className="grid gap-2 sm:grid-cols-4">
                {(Object.keys(AREAS_QR) as AreaQr[]).map((id) => (
                  <Escolha
                    key={id}
                    ativo={briefing.areaQr === id}
                    onClick={() => alterar('areaQr', id)}
                    titulo={AREAS_QR[id].nome}
                  />
                ))}
              </div>
              <div className="flex items-center gap-4 pt-1">
                {/* `htmlFor` não serve aqui: o `role="slider"` do Radix fica no
                    thumb, não num elemento rotulável. O nome acessível vem do
                    `aria-label`; este texto é a pista visual. */}
                <span className="shrink-0 text-xs text-muted-foreground">
                  Tamanho do espaço
                </span>
                <Slider
                  aria-label="Tamanho do espaço reservado para o QR Code, em porcentagem da largura"
                  value={[briefing.tamanhoQr]}
                  onValueChange={([v]) => alterar('tamanhoQr', v)}
                  min={10}
                  max={60}
                  step={1}
                  className="flex-1"
                />
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {briefing.tamanhoQr}%
                </span>
              </div>
            </Grupo>

            <Grupo
              titulo="O que precisa aparecer na arte"
              descricao="Marque só o que deve ser impresso. O que estiver em branco na sua marca é ignorado."
            >
              <div className="flex flex-wrap gap-2">
                {DESTAQUES_DISPONIVEIS.map((item) => (
                  <Escolha
                    key={item}
                    ativo={briefing.destaques.includes(item)}
                    onClick={() => alternarDestaque(item)}
                    titulo={item}
                    className="py-1.5"
                  />
                ))}
              </div>
            </Grupo>

            <Collapsible open={marcaAberta} onOpenChange={setMarcaAberta}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span>
                  <span className="block text-sm font-semibold text-foreground">Sua marca</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {briefing.empresa || 'Preencha o nome da empresa'} · {briefing.telefone || 'sem telefone'}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {marcaAberta ? 'Fechar' : 'Ajustar'}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="brief-empresa">Empresa</Label>
                    <Input
                      id="brief-empresa"
                      value={briefing.empresa}
                      onChange={(e) => alterar('empresa', e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="brief-telefone">WhatsApp</Label>
                    <Input
                      id="brief-telefone"
                      value={briefing.telefone}
                      onChange={(e) => alterar('telefone', e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="brief-creci">CRECI</Label>
                    <Input
                      id="brief-creci"
                      value={briefing.creci}
                      onChange={(e) => alterar('creci', e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="brief-site">Site</Label>
                    <Input
                      id="brief-site"
                      value={briefing.site}
                      onChange={(e) => alterar('site', e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ['corPrimaria', 'Cor principal'],
                    ['corSecundaria', 'Cor de apoio'],
                  ] as const).map(([campo, rotulo]) => (
                    <div key={campo}>
                      <Label htmlFor={`brief-${campo}`}>{rotulo}</Label>
                      <div className="mt-1.5 flex items-center gap-2">
                        <input
                          id={`brief-${campo}`}
                          type="color"
                          value={briefing[campo]}
                          onChange={(e) => alterar(campo, e.target.value)}
                          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-card p-1"
                        />
                        <Input
                          aria-label={`${rotulo} em hexadecimal`}
                          value={briefing[campo]}
                          onChange={(e) => alterar(campo, e.target.value)}
                          className="font-mono"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="brief-chamada">Chamada principal</Label>
                <Input
                  id="brief-chamada"
                  value={briefing.chamada}
                  onChange={(e) => alterar('chamada', e.target.value)}
                  placeholder="Veja esse imóvel por dentro"
                  className="mt-1.5"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Deixe em branco e o sistema escolhe uma pelo objetivo.
                </p>
              </div>
              <div>
                <Label htmlFor="brief-obs">Alguma exigência sua</Label>
                <Textarea
                  id="brief-obs"
                  value={briefing.observacoes}
                  onChange={(e) => alterar('observacoes', e.target.value)}
                  placeholder="Ex: nada de azul, a logo tem que ficar no topo"
                  rows={3}
                  className="mt-1.5 resize-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Button variant="ghost" onClick={irParaArte}>
                Já tenho a arte pronta
              </Button>
              <Button onClick={() => setPasso('prompt')} className="gap-2">
                Gerar meu prompt
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Passo 2: prompt ──────────────────────────────────────────── */}
        {passo === 'prompt' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Este é o pedido pronto. Abra o gerador, cole, e{' '}
              <strong className="font-medium text-foreground">anexe a logo da sua empresa</strong>{' '}
              na mesma mensagem.
            </p>

            {/* Único bloco escuro da experiência: é o artefato que sai daqui
                e vai para outro lugar, e a mudança de superfície diz isso. */}
            <div className="overflow-hidden rounded-card border border-brand-800 bg-brand-950">
              <div className="h-0.5 bg-gold" />
              <textarea
                aria-label="Prompt para o gerador de imagem"
                value={prompt}
                onChange={(e) => setPromptEditado(e.target.value)}
                spellCheck={false}
                rows={14}
                className="w-full resize-y bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-brand-50 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/60"
              />
            </div>

            {promptEditado !== null && (
              <p className="text-xs text-muted-foreground">
                Você editou o texto à mão. A partir de agora, mudanças no briefing não
                entram mais aqui.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={copiarPrompt} className="gap-2">
                {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiado ? 'Copiado' : 'Copiar prompt'}
              </Button>
              <Button onClick={abrirNoChat} className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Abrir no {DESTINOS_IA.find((d) => d.id === destino)?.nome}
              </Button>
              <Select value={destino} onValueChange={(v) => setDestino(v as DestinoIA)}>
                <SelectTrigger className="w-36" aria-label="Escolher o gerador">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DESTINOS_IA.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {promptEditado !== null && (
                <Button
                  variant="ghost"
                  onClick={() => setPromptEditado(null)}
                  className="text-muted-foreground"
                >
                  Voltar ao texto original
                </Button>
              )}
            </div>

            <div className="rounded-card border border-border bg-surface p-4">
              <h3 className="text-sm font-semibold text-foreground">Lá no gerador</h3>
              <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <li>1. Anexe o arquivo da sua logo antes de enviar o prompt.</li>
                <li>2. Peça ajustes até gostar — mudar cor, texto ou proporção.</li>
                <li>3. Baixe a imagem final em PNG e volte para esta tela.</li>
              </ol>
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                O prompt sai da Lotti e vai para um serviço externo. Ele leva apenas os
                dados da sua empresa que você marcou acima — nenhum dado de cliente ou
                de imóvel vai junto.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setPasso('briefing')} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Ajustar o briefing
              </Button>
              <Button onClick={irParaArte} className="gap-2">
                Já tenho a arte
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Passo 3: arte ────────────────────────────────────────────── */}
        {passo === 'arte' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="template-nome">Nome do template</Label>
              <Input
                id="template-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Placa vertical · Venda · Moderno"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label>Arte</Label>
              <div className="mt-1.5">
                {previewUrl ? (
                  <QrCodePositioner
                    imageSrc={previewUrl}
                    position={qrPosition}
                    onPositionChange={setQrPosition}
                    qrSizePercent={qrSize}
                    onSizeChange={setQrSize}
                    removeButton={
                      <button
                        type="button"
                        aria-label="Remover a arte"
                        onClick={() => {
                          setArquivo(null);
                          URL.revokeObjectURL(previewUrl);
                          setPreviewUrl(null);
                        }}
                        className="absolute right-2 top-2 z-50 rounded-lg bg-destructive/80 p-1.5 transition hover:bg-destructive"
                      >
                        <Trash2 className="h-4 w-4 text-destructive-foreground" />
                      </button>
                    }
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => inputArquivoRef.current?.click()}
                    {...dropProps}
                    className={cn(
                      'flex h-48 w-full flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      dragActive
                        ? 'border-primary bg-surface-brand'
                        : 'border-border-strong hover:border-primary/50 hover:bg-surface',
                    )}
                  >
                    <span className="rounded-full bg-surface-brand p-4">
                      <Upload className="h-7 w-7 text-primary" />
                    </span>
                    <span className="text-center">
                      <span className="block text-sm font-medium text-foreground">
                        Solte a arte aqui ou clique para escolher
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        PNG, JPG ou WebP
                      </span>
                    </span>
                  </button>
                )}
                <input
                  ref={inputArquivoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => selecionarArquivo(e.target.files?.[0])}
                />
              </div>
              {previewUrl && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Arraste o quadrado para o espaço que você reservou na arte. É ali que o
                  QR Code de cada imóvel vai ser impresso.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setPasso('prompt')} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Voltar ao prompt
              </Button>
              <Button
                onClick={salvar}
                disabled={!arquivo || !nome.trim() || salvando}
                className="gap-2"
              >
                {salvando
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando</>
                  : <><ImagePlus className="h-4 w-4" /> Salvar template</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
