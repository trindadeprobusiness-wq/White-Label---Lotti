import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  LockKeyhole,
  MessageCircleMore,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { LottiLogo } from '@/components/brand/LottiLogo';

const UPDATED_AT = '31 de agosto de 2026';

function usePublicPageMeta(title: string, description: string) {
  useEffect(() => {
    const previousTitle = document.title;
    const descriptionTag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = descriptionTag?.content;
    const meta = descriptionTag ?? document.head.appendChild(document.createElement('meta'));

    meta.name = 'description';
    meta.content = description;
    document.title = title;

    return () => {
      document.title = previousTitle;
      if (descriptionTag && previousDescription !== undefined) {
        descriptionTag.content = previousDescription;
      } else {
        meta.remove();
      }
    };
  }, [description, title]);
}

function PublicHeader() {
  return (
    <header className="border-b border-[#d9e3dd] bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4 sm:px-8">
        <Link to="/sobre" aria-label="Página inicial da Lotti" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#093323] focus-visible:ring-offset-4">
          <LottiLogo className="text-[#093323]" />
        </Link>
        <nav aria-label="Navegação pública" className="flex items-center gap-4 text-sm font-medium text-[#42574c] sm:gap-6">
          <Link className="hidden transition-colors hover:text-[#093323] sm:inline" to="/politica-de-privacidade">Privacidade</Link>
          <Link className="hidden transition-colors hover:text-[#093323] sm:inline" to="/termos-de-uso">Termos</Link>
          <a
            href="https://app.plataformalotti.com.br"
            className="inline-flex h-10 items-center rounded-full bg-[#093323] px-5 text-white shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#093323] focus-visible:ring-offset-2"
          >
            Entrar
          </a>
        </nav>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-[#d9e3dd] bg-[#edf3ef]">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 text-sm text-[#52665b] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div>
          <LottiLogo className="text-[#093323]" />
          <p className="mt-2">Operação imobiliária organizada, segura e conectada.</p>
        </div>
        <nav aria-label="Informações legais" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link className="hover:text-[#093323] hover:underline" to="/sobre">Sobre a Lotti</Link>
          <Link className="hover:text-[#093323] hover:underline" to="/politica-de-privacidade">Política de Privacidade</Link>
          <Link className="hover:text-[#093323] hover:underline" to="/termos-de-uso">Termos de Uso</Link>
        </nav>
      </div>
    </footer>
  );
}

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f7faf8] text-[#13231b]">
      <PublicHeader />
      {children}
      <PublicFooter />
    </div>
  );
}

function SyncBoard() {
  const events = [
    { time: '09:00', title: 'Retorno com comprador', source: 'Lotti' },
    { time: '11:30', title: 'Visita ao imóvel', source: 'Google Agenda' },
    { time: '15:00', title: 'Revisão do contrato', source: 'Lotti' },
  ];

  return (
    <div className="relative mx-auto w-full max-w-lg" aria-label="Exemplo de uma agenda sincronizada">
      <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_center,rgba(9,51,35,0.14),transparent_65%)]" />
      <div className="overflow-hidden rounded-[1.75rem] border border-[#cbd9d1] bg-white shadow-[0_30px_80px_rgba(9,51,35,0.14)]">
        <div className="flex items-center justify-between border-b border-[#e2e9e5] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#62756a]">Hoje</p>
            <p className="mt-1 font-semibold">Rotina conectada</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f1eb] px-3 py-1 text-xs font-semibold text-[#093323]">
            <span className="h-2 w-2 rounded-full bg-[#1d8a5e]" /> Sincronizada
          </span>
        </div>
        <div className="relative space-y-1 p-5">
          <div className="absolute bottom-8 left-[4.2rem] top-8 w-px bg-[#c8d7cf]" />
          {events.map((event) => (
            <div key={`${event.time}-${event.title}`} className="relative grid grid-cols-[3.1rem_1rem_1fr] items-center gap-3 py-3">
              <time className="text-xs font-semibold tabular-nums text-[#65786d]">{event.time}</time>
              <span className="relative z-10 h-3 w-3 rounded-full border-[3px] border-white bg-[#093323] ring-1 ring-[#a9bdb2]" />
              <div className="rounded-xl border border-[#e0e8e3] bg-[#fbfdfc] px-4 py-3">
                <p className="text-sm font-semibold">{event.title}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-[#65786d]">
                  <CalendarDays className="h-3.5 w-3.5" /> {event.source}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const serviceStages = [
  {
    icon: MessageCircleMore,
    title: 'Responde e entende',
    items: [
      'Responde na hora',
      'Separa compra de locação',
      'Mapeia faixa de preço, região, entrada e financiamento',
    ],
  },
  {
    icon: SearchCheck,
    title: 'Cruza e encaminha',
    items: [
      'Conecta o interesse aos imóveis disponíveis',
      'Agenda a visita',
      'Entrega o contexto completo ao corretor',
    ],
  },
  {
    icon: RefreshCw,
    title: 'Mantém a conversa viva',
    items: [
      'Faz follow-up no tempo certo',
      'Cultiva o relacionamento até o cliente estar pronto',
    ],
  },
];

function LottiServiceFlow() {
  return (
    <section id="como-funciona" className="relative overflow-hidden border-b border-[#d9e3dd] bg-[#f3f7f5]">
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[42%] bg-[linear-gradient(135deg,rgba(9,51,35,0.055),transparent_62%)] lg:block" />
      <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="grid gap-5 lg:grid-cols-[1.12fr_0.88fr] lg:items-end lg:gap-14">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-[#416050]">
              <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-[#093323]" />
              Como a Lotti trabalha
            </p>
            <h2 className="mt-4 max-w-3xl font-serif text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-[#0d2a1e] sm:text-5xl">
              A Lotti cuida do repetitivo. O corretor entra no momento certo.
            </h2>
          </div>
          <p className="max-w-xl text-base leading-7 text-[#52665b] sm:text-lg">
            Ela responde, qualifica, acompanha e agenda. O corretor recebe o contexto pronto para avançar.
          </p>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:gap-20">
          <figure className="relative mx-auto w-full max-w-[23rem] lg:mx-0">
            <div aria-hidden="true" className="absolute -inset-6 rounded-[3.5rem] border border-[#b8c9bf]/70" />
            <div aria-hidden="true" className="absolute -right-8 top-16 h-36 w-36 rounded-full bg-[#d5e7dc] blur-3xl" />

            <div className="relative rounded-[2.6rem] bg-[#092c20] p-[7px] shadow-[0_30px_70px_rgba(9,44,32,0.22)]">
              <div className="overflow-hidden rounded-[2.2rem] bg-[#f8fbf9]">
                <div className="relative flex items-center gap-3 bg-[#0b3b2a] px-5 pb-4 pt-7 text-white">
                  <span aria-hidden="true" className="absolute left-1/2 top-2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/20" />
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white font-serif text-lg font-semibold text-[#0b3b2a]">L</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Atendimento Lotti</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/70">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#78d7a5]" /> respondendo agora
                    </p>
                  </div>
                </div>

                <div className="space-y-3 px-4 py-5 text-[13px] leading-[1.45]">
                  <div className="ml-auto max-w-[84%] rounded-[1rem_1rem_0.3rem_1rem] bg-[#dcebe2] px-3.5 py-2.5 text-[#173b2c]">
                    Procuro um apartamento para comprar no Setor Bueno.
                  </div>
                  <div className="max-w-[88%] rounded-[1rem_1rem_1rem_0.3rem] border border-[#dbe5df] bg-white px-3.5 py-2.5 text-[#40564a] shadow-sm">
                    Perfeito. Qual faixa de valor e quanto pretende dar de entrada?
                  </div>

                  <div className="rounded-2xl border border-[#cbdcd2] bg-white p-3.5 shadow-[0_10px_30px_rgba(9,51,35,0.07)]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-[#163b2b]">Perfil organizado</p>
                      <span className="rounded-full bg-[#e8f2ec] px-2 py-1 text-[10px] font-semibold text-[#275640]">Completo</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-medium text-[#4d6558]">
                      {['Compra', 'Setor Bueno', 'Até R$ 650 mil', 'Entrada R$ 120 mil', 'Financiamento'].map((item) => (
                        <span key={item} className="rounded-full border border-[#dce6e0] bg-[#f8faf9] px-2 py-1">{item}</span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-[#0b3b2a] p-3 text-white">
                      <SearchCheck className="h-4 w-4 text-[#9dd1b4]" />
                      <p className="mt-2 text-xs font-semibold">3 imóveis</p>
                      <p className="mt-0.5 text-[11px] text-white/65">compatíveis</p>
                    </div>
                    <div className="rounded-xl border border-[#cbdcd2] bg-[#eef5f1] p-3 text-[#163b2b]">
                      <CalendarCheck2 className="h-4 w-4 text-[#2c7252]" />
                      <p className="mt-2 text-xs font-semibold">Visita</p>
                      <p className="mt-0.5 text-[11px] text-[#5e7468]">quinta, 15h</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <figcaption className="mt-5 text-center text-xs leading-5 text-[#687b70]">
              Exemplo de uma conversa qualificada pela Lotti.
            </figcaption>
          </figure>

          <div>
            <ol className="divide-y divide-[#cddbd3] border-y border-[#cddbd3]">
              {serviceStages.map(({ icon: Icon, title, items }, index) => (
                <li key={title} className="grid grid-cols-[2.75rem_1fr] gap-4 py-6 sm:grid-cols-[3.25rem_1fr] sm:gap-5 sm:py-7">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#b8cbbf] bg-white text-[#093323] shadow-sm sm:h-12 sm:w-12">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="text-lg font-semibold tracking-[-0.015em] text-[#173b2c] sm:text-xl">{title}</h3>
                      <span className="text-xs font-semibold tabular-nums text-[#7a8c82]">0{index + 1}</span>
                    </div>
                    <ul className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
                      {items.map((item) => (
                        <li key={item} className="flex gap-2 text-sm leading-5 text-[#53685c]">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#26714e]" aria-hidden="true" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex items-start gap-3 rounded-2xl bg-[#dfece5] px-4 py-4 text-sm leading-6 text-[#234b39] sm:px-5">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p><strong className="font-semibold">Para o corretor:</strong> atendimento organizado, próximos passos claros e mais tempo para negociar.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PaginaInicialPublica() {
  usePublicPageMeta(
    'Lotti — CRM imobiliário',
    'CRM imobiliário para organizar clientes, imóveis, contratos, agenda e operação em um só lugar.',
  );

  return (
    <PublicShell>
      <main>
        <section className="overflow-hidden border-b border-[#d9e3dd] bg-white">
          <div className="mx-auto grid max-w-6xl gap-14 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[#c9d8d0] bg-[#f3f7f5] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#315143]">
                <Sparkles className="h-3.5 w-3.5" /> CRM imobiliário com rotina
              </p>
              <h1 className="mt-6 max-w-3xl font-serif text-4xl font-semibold leading-[1.04] tracking-[-0.035em] text-[#0d2a1e] sm:text-6xl">
                Clientes, imóveis e negociações. Cada próximo passo à vista.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-[#52665b]">
                A Lotti reúne funil, contratos, financeiro e compromissos em uma rotina clara — do primeiro contato à assinatura. Se quiser, conecte também o Google Agenda.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="https://app.plataformalotti.com.br"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#093323] px-6 font-semibold text-white shadow-lg shadow-[#093323]/15 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#093323] focus-visible:ring-offset-2"
                >
                  Entrar na Lotti <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href="#como-funciona"
                  className="inline-flex h-12 items-center justify-center rounded-full border border-[#b9cbbf] bg-white px-6 font-semibold text-[#173b2c] hover:bg-[#f3f7f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#093323] focus-visible:ring-offset-2"
                >
                  Conhecer a plataforma
                </a>
              </div>
            </div>
            <SyncBoard />
          </div>
        </section>

        <LottiServiceFlow />

        <section className="bg-[#092c20] text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#a9d2bc]">Google Agenda, sob seu controle</p>
              <h2 className="mt-3 font-serif text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Conecte somente quando fizer sentido.</h2>
            </div>
            <div className="space-y-4 text-[#d7e6de]">
              <p className="leading-7">A integração usa permissões específicas para listar suas agendas e sincronizar eventos. Você escolhe os calendários, a direção da sincronização e o nível de detalhe enviado.</p>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5"><Check className="h-4 w-4 text-[#91d0ad]" /> Conexão opcional</span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5"><LockKeyhole className="h-4 w-4 text-[#91d0ad]" /> Tokens criptografados</span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5"><ShieldCheck className="h-4 w-4 text-[#91d0ad]" /> Revogação a qualquer momento</span>
              </div>
              <Link className="inline-flex items-center gap-2 font-semibold text-white underline decoration-[#77b996] underline-offset-4" to="/politica-de-privacidade">
                Entenda como os dados são tratados <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}

function LegalPage({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <main>
        <section className="border-b border-[#d9e3dd] bg-white">
          <div className="mx-auto max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#4c6b5c]">{eyebrow}</p>
            <h1 className="mt-3 font-serif text-4xl font-semibold tracking-[-0.03em] text-[#0d2a1e] sm:text-5xl">{title}</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-[#52665b]">{summary}</p>
            <p className="mt-4 text-sm text-[#6a7d72]">Última atualização: {UPDATED_AT}</p>
          </div>
        </section>
        <article className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
          <div className="space-y-10 text-[15px] leading-7 text-[#3d5146] [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-[-0.02em] [&_h2]:text-[#123326] [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-[#173b2c] [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2">
            {children}
          </div>
        </article>
      </main>
    </PublicShell>
  );
}

export function PoliticaPrivacidade() {
  usePublicPageMeta(
    'Política de Privacidade — Lotti',
    'Como a Lotti coleta, usa, protege e permite excluir dados, inclusive na integração com o Google Agenda.',
  );

  return (
    <LegalPage
      eyebrow="Confiança por desenho"
      title="Política de Privacidade"
      summary="Esta política explica, em linguagem direta, quais dados a Lotti trata, para quais finalidades e quais controles ficam nas mãos de cada usuário."
    >
      <section>
        <h2>1. Escopo e responsabilidade</h2>
        <p className="mt-3">A Lotti é uma plataforma de gestão imobiliária. Esta política se aplica ao site, ao aplicativo e às integrações ativadas pelo usuário. Cada organização continua responsável pela origem e pela legitimidade dos dados profissionais inseridos por sua equipe.</p>
      </section>

      <section>
        <h2>2. Dados tratados pela plataforma</h2>
        <ul className="mt-3">
          <li><strong>Conta e acesso:</strong> nome, e-mail, identificadores de autenticação e informações necessárias para manter a sessão segura.</li>
          <li><strong>Operação imobiliária:</strong> dados que o usuário registra sobre clientes, imóveis, negociações, contratos, documentos, tarefas e finanças.</li>
          <li><strong>Uso e segurança:</strong> registros técnicos necessários para diagnosticar falhas, prevenir abuso e manter a disponibilidade do serviço.</li>
        </ul>
      </section>

      <section className="rounded-2xl border border-[#cddbd3] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e7f1eb] text-[#093323]"><CalendarDays className="h-5 w-5" /></span>
          <div>
            <h2>3. Integração com o Google Agenda</h2>
            <p className="mt-3">A conexão é opcional e só começa depois do consentimento do titular da Conta do Google. A Lotti solicita:</p>
          </div>
        </div>
        <ul className="mt-4">
          <li><strong>calendar.calendarlist.readonly:</strong> permite listar as agendas disponíveis, com identificador, nome, cor e nível de acesso, para que o usuário escolha quais deseja sincronizar.</li>
          <li><strong>calendar.events:</strong> permite ler, criar, alterar e cancelar eventos nas agendas selecionadas, viabilizando sincronização de uma ou duas direções.</li>
          <li><strong>openid e e-mail:</strong> identificam qual Conta do Google foi conectada e exibem essa informação ao próprio usuário.</li>
        </ul>
        <p className="mt-4">Os dados de eventos podem incluir título, descrição, data e horário, recorrência, local e status. Eles são usados somente para mostrar a agenda na Lotti, detectar conflitos e manter as alterações sincronizadas conforme as escolhas do usuário.</p>
      </section>

      <section>
        <h2>4. Armazenamento e proteção</h2>
        <ul className="mt-3">
          <li>Os tokens OAuth são criptografados antes de serem armazenados e não ficam disponíveis ao navegador.</li>
          <li>Acesso e atualização de dados são limitados por usuário e organização.</li>
          <li>O tráfego usa conexão HTTPS e a integração aplica controles de estado OAuth, PKCE e validação de notificações.</li>
        </ul>
      </section>

      <section>
        <h2>5. Compartilhamento e uso limitado</h2>
        <p className="mt-3">A Lotti não vende dados do Google, não os utiliza para publicidade e não os transfere para corretores de dados. Prestadores de infraestrutura podem processar informações apenas na medida necessária para hospedar, proteger e operar a plataforma, sujeitos a obrigações de segurança e confidencialidade.</p>
        <p className="mt-3">O uso de informações recebidas das APIs do Google observa a <a className="font-semibold text-[#0b5d3c] underline underline-offset-4" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Política de Dados do Usuário dos Serviços de API do Google</a>, inclusive os requisitos de Uso Limitado.</p>
      </section>

      <section>
        <h2>6. Retenção, desconexão e exclusão</h2>
        <p className="mt-3">Em <strong>Rotina → Google Agenda</strong>, o usuário pode selecionar <strong>Desconectar Google Agenda</strong>. Essa ação revoga a autorização no Google e exclui da Lotti os tokens e metadados técnicos da conexão. Eventos já importados podem permanecer como registros operacionais até que sejam excluídos pelo usuário ou junto com sua conta.</p>
        <p className="mt-3">Também é possível revogar o acesso diretamente nas configurações de segurança da Conta do Google. Solicitações de acesso, correção ou exclusão podem ser feitas pelo canal de suporte disponível dentro da Lotti.</p>
      </section>

      <section>
        <h2>7. Alterações desta política</h2>
        <p className="mt-3">Esta política pode ser atualizada para refletir mudanças legais, técnicas ou do produto. A data no início da página indica a versão vigente. Alterações relevantes serão comunicadas pelos canais disponíveis no serviço.</p>
      </section>
    </LegalPage>
  );
}

export function TermosUso() {
  usePublicPageMeta(
    'Termos de Uso — Lotti',
    'Regras para uso responsável da plataforma Lotti e de suas integrações.',
  );

  return (
    <LegalPage
      eyebrow="Regras claras para operar"
      title="Termos de Uso"
      summary="Estes termos regulam o acesso à Lotti e definem responsabilidades essenciais para o uso seguro da plataforma e de suas integrações."
    >
      <section>
        <h2>1. Aceitação e finalidade</h2>
        <p className="mt-3">Ao criar uma conta ou usar a Lotti, você concorda com estes termos. A plataforma oferece recursos de CRM, rotina, documentos, imóveis, contratos, finanças e integrações para apoiar a operação imobiliária. Ela não substitui análise jurídica, contábil ou financeira profissional.</p>
      </section>

      <section>
        <h2>2. Conta e segurança</h2>
        <p className="mt-3">Você é responsável pela sua conta, pela veracidade das informações cadastradas e pela proteção de suas credenciais. Não compartilhe senhas ou sessões. Avise o suporte ao identificar acesso não autorizado.</p>
      </section>

      <section>
        <h2>3. Uso permitido</h2>
        <ul className="mt-3">
          <li>Use a Lotti somente para finalidades legítimas e relacionadas à sua atividade.</li>
          <li>Não tente contornar controles de acesso, acessar dados de outra organização, interferir na disponibilidade do serviço ou introduzir código malicioso.</li>
          <li>Cadastre dados pessoais apenas quando tiver base legal e autorização adequadas para tratá-los.</li>
        </ul>
      </section>

      <section>
        <h2>4. Integrações e serviços de terceiros</h2>
        <p className="mt-3">Recursos como Google Agenda, processamento de pagamentos e serviços de inteligência artificial dependem de serviços de terceiros e também estão sujeitos aos termos desses fornecedores. A ativação de cada integração é opcional e deve ser feita por usuário autorizado.</p>
        <p className="mt-3">O usuário pode encerrar a integração com o Google Agenda a qualquer momento pela Lotti ou pela Conta do Google. A desconexão interrompe novas sincronizações, sem alterar obrigações já assumidas ou registros que o usuário tenha decidido manter na plataforma.</p>
      </section>

      <section>
        <h2>5. Conteúdo e responsabilidade operacional</h2>
        <p className="mt-3">Os dados e documentos inseridos permanecem sob responsabilidade da organização que os cadastrou. Sugestões, minutas e automações devem ser revisadas antes do uso. O usuário decide e confirma ações que possam produzir efeitos comerciais, jurídicos ou financeiros.</p>
      </section>

      <section>
        <h2>6. Disponibilidade e evolução</h2>
        <p className="mt-3">A Lotti busca manter o serviço disponível e seguro, mas pode realizar manutenções, corrigir falhas e evoluir funcionalidades. Integrações externas podem sofrer indisponibilidade, alteração de limites ou mudanças de política fora do controle da plataforma.</p>
      </section>

      <section>
        <h2>7. Suspensão e encerramento</h2>
        <p className="mt-3">O acesso pode ser suspenso diante de fraude, risco de segurança, violação destes termos ou obrigação legal. O usuário pode solicitar o encerramento da conta e a exclusão dos dados aplicáveis pelo canal de suporte da Lotti, respeitados prazos legais de retenção.</p>
      </section>

      <section>
        <h2>8. Privacidade e alterações</h2>
        <p className="mt-3">O tratamento de dados é explicado na <Link className="font-semibold text-[#0b5d3c] underline underline-offset-4" to="/politica-de-privacidade">Política de Privacidade</Link>. Estes termos podem ser atualizados quando o produto ou a legislação mudar; a versão vigente será sempre publicada nesta página.</p>
      </section>
    </LegalPage>
  );
}

