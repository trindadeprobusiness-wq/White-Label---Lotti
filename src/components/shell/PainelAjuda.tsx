import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HelpCircle, Search, Sparkles, AlertTriangle, SearchX } from 'lucide-react';
import {
  ATALHOS,
  topicosDaRota,
  buscarTopicos,
  pertenceARota,
  type TopicoAjuda,
} from '@/lib/ajuda';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Ajuda do workspace.
 *
 * O "?" era um botão morto: mostrava tooltip e não abria nada. Ícone que não
 * faz nada é pior que ícone ausente — a pessoa clica, nada acontece, e conclui
 * que o sistema está quebrado.
 *
 * Três escolhas que definem o formato:
 *
 *  1. **Gaveta lateral, não modal.** A ajuda fica aberta enquanto a pessoa
 *     executa o passo na tela atrás. Modal obrigaria a decorar e fechar.
 *  2. **Abre no assunto da tela.** Quem trava em Fachadas quer fachada, não um
 *     índice de tudo. Os tópicos gerais continuam ali, abaixo.
 *  3. **Busca pelo problema.** A pessoa digita "não recebi aviso do pix", não
 *     o nome que demos ao tópico — por isso a busca varre passos e sinônimos,
 *     sem acento (ver `lib/ajuda.ts`).
 */

/** Nome da tela para o cabeçalho contextual. Só as que têm ajuda própria. */
const NOME_DA_TELA: { rota: string; nome: string }[] = [
  { rota: '/clientes', nome: 'Clientes' },
  { rota: '/imoveis', nome: 'Imóveis' },
  { rota: '/crm', nome: 'Funil de Vendas' },
  { rota: '/funil', nome: 'Funil de Vendas' },
  { rota: '/financeiro', nome: 'Financeiro' },
  { rota: '/juridico', nome: 'Jurídico' },
  { rota: '/midias', nome: 'Mídias' },
  { rota: '/fachadas', nome: 'Fachadas Inteligentes' },
  { rota: '/alugueis', nome: 'Aluguéis' },
  { rota: '/assistente', nome: 'Assistente IA' },
  { rota: '/configuracoes', nome: 'Configurações' },
];

function nomeDaTela(rota: string): string {
  const achado = NOME_DA_TELA.find(
    (t) => rota === t.rota || rota.startsWith(`${t.rota}/`),
  );
  return achado?.nome ?? 'Início';
}

function CorpoTopico({ topico }: { topico: TopicoAjuda }) {
  return (
    <div className="space-y-3 pb-1">
      <p className="text-sm leading-relaxed text-muted-foreground">{topico.resumo}</p>

      {topico.passos && (
        <ol className="space-y-2">
          {topico.passos.map((passo, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground tabular">
                {i + 1}
              </span>
              <span className="min-w-0">{passo}</span>
            </li>
          ))}
        </ol>
      )}

      {topico.atencao && (
        <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="min-w-0 text-xs leading-relaxed text-foreground">{topico.atencao}</p>
        </div>
      )}
    </div>
  );
}

export function PainelAjuda() {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Trocar de tela com a gaveta aberta tem que trocar o contexto junto; o
  // termo antigo ficaria filtrando a tela nova sem que ninguém entendesse.
  useEffect(() => {
    setTermo('');
  }, [pathname]);

  // "?" abre a ajuda — mas nunca enquanto a pessoa escreve, senão digitar uma
  // pergunta num campo de texto abriria a gaveta no meio da frase.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      if (
        alvo?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo?.tagName ?? '')
      ) return;
      e.preventDefault();
      setAberto(true);
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, []);

  const buscando = termo.trim().length >= 2;
  const resultados = useMemo(
    () => (buscando ? buscarTopicos(termo, pathname) : topicosDaRota(pathname)),
    [termo, pathname, buscando],
  );

  const daTela = resultados.filter(
    (t) => pertenceARota(t, pathname) && !t.rotas.includes('*'),
  );
  const outros = resultados.filter((t) => !daTela.includes(t));

  // Abre já expandido o primeiro item — a pessoa clicou em "ajuda", não em
  // "índice"; fazê-la dar mais um clique para ver qualquer conteúdo é atrito.
  const primeiro = resultados[0]?.id;

  const Secao = ({ titulo, itens }: { titulo: string; itens: TopicoAjuda[] }) =>
    itens.length === 0 ? null : (
      <section>
        <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {titulo}
        </p>
        <Accordion type="multiple" defaultValue={primeiro ? [primeiro] : []}>
          {itens.map((t) => (
            <AccordionItem key={t.id} value={t.id} className="border-border">
              <AccordionTrigger className="py-3 text-left text-sm font-medium hover:no-underline">
                {t.titulo}
              </AccordionTrigger>
              <AccordionContent>
                <CorpoTopico topico={t} />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    );

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-ring"
              aria-label="Ajuda"
            >
              <HelpCircle className="h-[18px] w-[18px]" />
            </button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Ajuda <span className="ml-1 opacity-60">?</span>
        </TooltipContent>
      </Tooltip>

      <SheetContent
        side="right"
        className="flex w-[min(26rem,100vw)] flex-col gap-0 p-0 sm:max-w-none"
      >
        <SheetHeader className="space-y-3 border-b border-border px-5 py-4 text-left">
          <div>
            <SheetTitle className="text-base">Ajuda</SheetTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Você está em {nomeDaTela(pathname)}
            </p>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Busque pelo que você quer fazer"
              aria-label="Buscar na ajuda"
              // min-h/text-base: no celular, fonte menor que 16px faz o iOS
              // dar zoom sozinho ao focar o campo.
              className="min-h-[44px] w-full rounded-lg border border-border bg-background pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground focus-ring sm:text-sm"
            />
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {resultados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <SearchX className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-foreground">
                Nada encontrado para "{termo.trim()}"
              </p>
              <p className="max-w-[17rem] text-xs leading-relaxed text-muted-foreground">
                Tente outra palavra — ou pergunte direto à IA Lotti, que conhece
                os seus dados.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => { setAberto(false); navigate('/assistente'); }}
              >
                <Sparkles className="mr-1.5 h-4 w-4" />
                Perguntar à IA Lotti
              </Button>
            </div>
          ) : buscando ? (
            <Secao titulo={`${resultados.length} resultado${resultados.length > 1 ? 's' : ''}`} itens={resultados} />
          ) : (
            <>
              <Secao titulo={`Nesta tela — ${nomeDaTela(pathname)}`} itens={daTela} />
              <Secao titulo="Vale para todo o sistema" itens={outros} />
            </>
          )}
        </div>

        <div className="border-t border-border px-5 py-4">
          {/* Atalhos de teclado no celular são espaço gasto com o que ninguém
              consegue usar — e espaço é justamente o que falta ali. */}
          <p className="mb-2 hidden text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:block">
            Atalhos
          </p>
          <ul className="mb-4 hidden space-y-1.5 sm:block">
            {ATALHOS.map((a) => (
              <li key={a.teclas} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{a.acao}</span>
                <span className="flex gap-1">
                  {a.teclas.split(' ').map((t) => (
                    <kbd
                      key={t}
                      className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-foreground"
                    >
                      {t}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>

          <Button
            variant="outline"
            className="w-full justify-center"
            onClick={() => { setAberto(false); navigate('/assistente'); }}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Perguntar à IA Lotti
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
