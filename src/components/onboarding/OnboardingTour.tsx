import { useMemo, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useOnboarding } from '@/hooks/useOnboarding';

interface TourConfig {
  key: string;
  rotas: string[];
  passos: Array<{ titulo: string; texto: string }>;
}

const TOURS: TourConfig[] = [
  {
    key: 'clientes',
    rotas: ['/clientes'],
    passos: [
      { titulo: 'Clientes começam com contexto', texto: 'Registre interesse e origem agora; documentos e detalhes podem vir depois.' },
      { titulo: 'Sempre deixe uma próxima ação', texto: 'Abra o cliente para registrar contato e agendar o retorno.' },
    ],
  },
  {
    key: 'imoveis',
    rotas: ['/imoveis'],
    passos: [
      { titulo: 'Cadastre o essencial primeiro', texto: 'Tipo, finalidade, localização e valor bastam para começar.' },
      { titulo: 'Complete quando houver material', texto: 'Depois adicione fotos, mídia e descrição com IA no cadastro do imóvel.' },
    ],
  },
  {
    key: 'pipeline',
    rotas: ['/crm', '/funil'],
    passos: [
      { titulo: 'Cada card é uma oportunidade', texto: 'Relacione cliente e imóvel e mova o negócio conforme ele avança.' },
      { titulo: 'O funil precisa de próximo passo', texto: 'Crie uma tarefa no negócio para o follow-up não depender da memória.' },
    ],
  },
  {
    key: 'rotina',
    rotas: ['/planejamento'],
    passos: [
      { titulo: 'Seu dia começa pela próxima ação', texto: 'Compromissos, tarefas e follow-ups ficam juntos, com responsável e prazo.' },
      { titulo: 'Google Agenda sem duplicidade', texto: 'Conecte o calendário no fim da página e escolha quais agendas e sentidos deseja sincronizar.' },
    ],
  },
  {
    key: 'assistente_ia',
    rotas: ['/assistente'],
    passos: [
      { titulo: 'Peça uma ação concreta', texto: 'A IA pode consultar contexto e preparar conteúdo, mas você confirma antes de executar.' },
      { titulo: 'Revise antes de usar', texto: 'Respostas de IA apoiam a operação; dados e decisões finais continuam sob seu controle.' },
    ],
  },
  {
    key: 'backoffice',
    rotas: ['/admin'],
    passos: [
      { titulo: 'Acompanhe ativação sem abrir dados do cliente', texto: 'Use as métricas agregadas para localizar etapas de abandono e contas travadas.' },
      { titulo: 'Acesso administrativo deixa trilha', texto: 'Ações sensíveis exigem permissão e ficam registradas na auditoria.' },
    ],
  },
];

export function OnboardingTour() {
  const { pathname } = useLocation();
  const { contexto, salvarTour } = useOnboarding();
  const [passo, setPasso] = useState(0);
  const tour = useMemo(
    () => TOURS.find((item) => item.rotas.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))),
    [pathname],
  );

  if (!tour || !contexto || contexto.metadata.legacy_account === true) return null;
  if (!contexto.concluidoEm && !contexto.dispensadoEm) return null;
  if (contexto.toursConcluidos.includes(tour.key) || contexto.toursDispensados.includes(tour.key)) return null;

  const atual = tour.passos[passo];
  const ultimo = passo === tour.passos.length - 1;

  return (
    <aside className="fixed bottom-5 left-5 z-40 w-[calc(100vw-2.5rem)] max-w-sm rounded-xl border border-primary/20 bg-card p-4 shadow-xl motion-reduce:transition-none" aria-live="polite">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Dica {passo + 1} de {tour.passos.length}
          </p>
          <h2 className="font-semibold">{atual.titulo}</h2>
        </div>
        <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-9 w-9" aria-label="Dispensar tour" onClick={() => void salvarTour(tour.key, 'dispensado', passo)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <p className="mb-4 text-sm leading-6 text-muted-foreground">{atual.texto}</p>
      <Button size="sm" className="w-full" onClick={() => {
        if (ultimo) void salvarTour(tour.key, 'concluido', passo);
        else setPasso((valor) => valor + 1);
      }}>
        {ultimo ? <><Check className="mr-2 h-4 w-4" />Entendi</> : <>Próxima dica<ArrowRight className="ml-2 h-4 w-4" /></>}
      </Button>
    </aside>
  );
}
