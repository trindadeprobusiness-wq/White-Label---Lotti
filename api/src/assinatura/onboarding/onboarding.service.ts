import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import { Linha } from '../assinatura.dto';
import { erroApi, OpcoesErro, traduzirErroAssinatura } from '../assinatura.erros';
import {
  AceitarConviteDto, AcaoOnboardingDto, ChecklistOnboardingDto, COLUNAS_CHECKLIST, COLUNAS_ORGANIZACAO, COLUNAS_PERFIL,
  ConviteDto, EventoOnboardingDto, MAPA_ORGANIZACAO, OrganizacaoDto, PerfilProfissionalDto, SalvarOnboardingDto,
  TourOnboardingDto,
} from './onboarding.dto';

type Tx = Prisma.TransactionClient;
type Linhas = Array<{ linha: Linha | null }>;

export interface RespostaAcao {
  id?: string;
  reused?: boolean;
  removed?: boolean;
}

export interface RespostaConvite {
  id: string;
  token: string;
  expires_in_days: number;
}

export interface RespostaAceite {
  organization_id: string;
  papel: string;
}

const nadaParaAtualizar = () => erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.');
const naoEncontrado = (message: string) => erroApi(404, 'nao_encontrado', message);

export function presentes<T extends string>(dados: object, permitidas: readonly T[]): T[] {
  return permitidas.filter((c) => (dados as Record<string, unknown>)[c] !== undefined);
}

/** Colunas vêm só das constantes do DTO; os valores vão num JSON convertido pelo próprio banco. */
export function montarCampos(dados: Record<string, unknown>, cols: readonly string[]) {
  const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, dados[c]])));
  const alvo = Prisma.raw(cols.join(', '));
  const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
  return { json, alvo, origem };
}

/**
 * Onboarding: a API chama as funções do banco como elas são. `onboarding_executar_acao` continua
 * atômica e idempotente, e os gatilhos de cota continuam valendo (o 402 vem do banco).
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly db: TenantDb) {}

  /** Erro do banco é traduzido fora do run: dentro dele a transação já está abortada. */
  private async rodar<T>(claims: SupabaseClaims, trabalho: (tx: Tx) => Promise<T>, op: OpcoesErro = {}): Promise<T> {
    try {
      return await this.db.run(claims, trabalho);
    } catch (e) {
      traduzirErroAssinatura(e, op);
    }
  }

  /** O1: sem perfil a função devolve NULL, e a rota responde 200 com corpo null. */
  async contexto(claims: SupabaseClaims): Promise<Linha | null> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select public.get_onboarding_contexto() as linha`));
    return linhas[0]?.linha ?? null;
  }

  /** O2 */
  async salvar(claims: SupabaseClaims, dto: SalvarOnboardingDto): Promise<Linha | null> {
    const profile = JSON.stringify(dto.profile ?? {});
    const progress = JSON.stringify(dto.progress ?? {});
    const stepKey = dto.stepKey ?? null;
    const stepStatus = dto.stepStatus ?? null;
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select public.salvar_onboarding(${profile}::jsonb, ${progress}::jsonb, ${stepKey}::text, ${stepStatus}::text) as linha`),
      { padrao: 'Não foi possível salvar o onboarding.' });
    return linhas[0]?.linha ?? null;
  }

  /** O3: a RPC é atômica e idempotente no banco; a API só chama. */
  async executarAcao(claims: SupabaseClaims, dto: AcaoOnboardingDto): Promise<RespostaAcao> {
    const payload = JSON.stringify(dto.payload ?? {});
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Array<{ linha: RespostaAcao }>>(Prisma.sql`
      select public.onboarding_executar_acao(${dto.action}::text, ${payload}::jsonb) as linha`));
    return linhas[0].linha;
  }

  /** O4: a função é void; por $queryRaw o Prisma falharia ao desserializar a coluna. */
  async registrarEvento(claims: SupabaseClaims, dto: EventoOnboardingDto): Promise<void> {
    const stepKey = dto.stepKey ?? null;
    const source = dto.source ?? 'onboarding';
    const metadata = JSON.stringify(dto.metadata ?? {});
    await this.rodar(claims, (tx) => tx.$executeRaw(Prisma.sql`
      select public.registrar_onboarding_evento(${dto.eventName}::text, ${stepKey}::text, ${source}::text, ${metadata}::jsonb)`));
  }

  /** O5: a função é void. */
  async salvarTour(claims: SupabaseClaims, dto: TourOnboardingDto): Promise<void> {
    const passo = dto.currentStep ?? 0;
    await this.rodar(claims, (tx) => tx.$executeRaw(Prisma.sql`
      select public.salvar_onboarding_tour(${dto.tourKey}::text, ${dto.status}::text, ${passo}::int)`));
  }

  /** O6: profile_id vem de claims.sub, nunca do corpo. `dismissed: false` é ignorado, como no hook. */
  async salvarChecklist(claims: SupabaseClaims, dto: ChecklistOnboardingDto): Promise<void> {
    if (dto.minimized === undefined && dto.dismissed === undefined) throw nadaParaAtualizar();
    const agora = new Date().toISOString();
    const dados: Record<string, unknown> = { atualizado_em: agora };
    if (dto.minimized !== undefined) dados.minimized = dto.minimized;
    if (dto.dismissed === true) dados.dismissed_at = agora;
    const cols = presentes(dados, COLUNAS_CHECKLIST);
    if (cols.length === 0) throw nadaParaAtualizar();
    const { json, alvo, origem } = montarCampos(dados, cols);
    await this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<unknown[]>(Prisma.sql`
        update public.onboarding_checklist c set (${alvo}) = (select ${origem}
            from jsonb_populate_record(null::public.onboarding_checklist, ${json}::jsonb) r)
        where c.profile_id = (select p.id from public.onboarding_profiles p where p.user_id = ${claims.sub}::uuid)
        returning c.id`);
      if (r.length === 0) throw naoEncontrado('Seu onboarding ainda não foi criado. Recarregue a página.');
    });
  }

  /** O7: o user_id sai das claims; nenhuma viagem a auth.getUser(). */
  async atualizarPerfil(claims: SupabaseClaims, dto: PerfilProfissionalDto): Promise<void> {
    const cols = presentes(dto, COLUNAS_PERFIL);
    if (cols.length === 0) throw nadaParaAtualizar();
    const { json, alvo, origem } = montarCampos(dto as Record<string, unknown>, cols);
    await this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<unknown[]>(Prisma.sql`
        update public.corretores t set (${alvo}) = (select ${origem}
            from jsonb_populate_record(null::public.corretores, ${json}::jsonb) r)
        where t.user_id = ${claims.sub}::uuid returning t.id`);
      if (r.length === 0) throw naoEncontrado('Perfil não encontrado.');
    });
  }

  /** O8: o :id vai na URL e a policy `routine organizations: managers update` é quem autoriza. */
  async atualizarOrganizacao(claims: SupabaseClaims, id: string, dto: OrganizacaoDto): Promise<void> {
    const dados: Record<string, unknown> = {};
    for (const [chave, coluna] of Object.entries(MAPA_ORGANIZACAO)) {
      const valor = (dto as Record<string, unknown>)[chave];
      if (valor !== undefined) dados[coluna] = valor;
    }
    const cols = presentes(dados, COLUNAS_ORGANIZACAO);
    if (cols.length === 0) throw nadaParaAtualizar();
    const { json, alvo, origem } = montarCampos(dados, cols);
    await this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<unknown[]>(Prisma.sql`
        update public.routine_organizations t set (${alvo}) = (select ${origem}
            from jsonb_populate_record(null::public.routine_organizations, ${json}::jsonb) r)
        where t.id = ${id}::uuid returning t.id`);
      if (r.length === 0) throw naoEncontrado('Organização não encontrada.');
    });
  }

  /** O9: o token nunca é registrado em log nem repetido em mensagem de erro. */
  async criarConvite(claims: SupabaseClaims, dto: ConviteDto): Promise<RespostaConvite> {
    const papel = dto.papel ?? 'corretor';
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Array<{ linha: RespostaConvite }>>(Prisma.sql`
      select public.criar_convite_organizacao(${dto.email}::text, ${papel}::text) as linha`),
      { padrao: 'Não foi possível preparar o convite.' });
    return linhas[0].linha;
  }

  /** O10 */
  async aceitarConvite(claims: SupabaseClaims, dto: AceitarConviteDto): Promise<RespostaAceite> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Array<{ linha: RespostaAceite }>>(Prisma.sql`
      select public.aceitar_convite_organizacao(${dto.token}::text) as linha`),
      { padrao: 'Não foi possível aceitar o convite.' });
    return linhas[0].linha;
  }
}
