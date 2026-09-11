import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  FileText,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Users2,
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
                O trabalho imobiliário avança quando a rotina não se perde.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-[#52665b]">
                A Lotti reúne clientes, imóveis, funil, contratos, financeiro e Google Agenda para que cada próximo passo fique claro — do primeiro contato à assinatura.
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

        <section id="como-funciona" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#4c6b5c]">Uma operação, uma leitura</p>
            <h2 className="mt-3 font-serif text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Contexto suficiente para decidir. Estrutura suficiente para executar.</h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { icon: Users2, title: 'Relacionamento', text: 'Clientes, histórico, follow-ups e funil comercial no mesmo fluxo.' },
              { icon: Building2, title: 'Operação', text: 'Imóveis, contratos, documentos, cobranças e repasses organizados.' },
              { icon: Clock3, title: 'Rotina', text: 'Tarefas e compromissos com sincronização opcional do Google Agenda.' },
            ].map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-2xl border border-[#d8e3dc] bg-white p-6 shadow-sm">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8f1ec] text-[#093323]"><Icon className="h-5 w-5" /></span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#5c6f64]">{text}</p>
              </article>
            ))}
          </div>
        </section>

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

