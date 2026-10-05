import { HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import { Fetcher, FETCH_ROTINA, safeErrorCode } from '../google/google-http';
import { lerConfigRotina } from '../rotina.config';
import { exigirContexto } from '../rotina.contexto';
import { ComandoDto } from '../rotina.dto';
import { ERROS, traduzirErroBanco } from '../rotina.erros';

// Porte de supabase/functions/routine-command (as 26 categorias copiadas do Deno).
export const ACTIVITIES = [
  'prospeccao', 'primeiro_atendimento', 'follow_up', 'qualificacao_lead', 'ligacao',
  'reuniao', 'visita_imovel', 'captacao_imovel', 'avaliacao', 'producao_midias',
  'publicacao_anuncio', 'envio_proposta', 'negociacao', 'separacao_documentos',
  'analise_juridica', 'assinatura_contrato', 'vistoria', 'entrega_chaves', 'cobranca',
  'pagamento', 'renovacao_contratual', 'manutencao', 'reuniao_interna',
  'tarefa_administrativa', 'compromisso_pessoal', 'outro',
];
export const URL_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const LIMITE_CANDIDATOS = 120;

function parseJsonContent(content: unknown): Record<string, unknown> {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}

function cleanText(value: unknown, max = 180): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, max);
  return text || null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function findCandidate<T extends { id: string; label: string }>(query: string | null, candidates: T[]): T | null {
  if (!query) return null;
  const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const wanted = normalize(query);
  return candidates.find((candidate) => normalize(candidate.label) === wanted)
    || candidates.find((candidate) => normalize(candidate.label).includes(wanted) || wanted.includes(normalize(candidate.label)))
    || null;
}

const retentavel = (status: number) => status === 408 || status === 429 || status >= 500;

@Injectable()
export class RotinaComandoService {
  private readonly logger = new Logger('RotinaComando');
  private readonly fetcher: Fetcher;
  private readonly esperar: (ms: number) => Promise<void>;

  constructor(
    private readonly db: TenantDb,
    @Optional() @Inject(FETCH_ROTINA) fetcher?: Fetcher,
  ) {
    this.fetcher = fetcher ?? ((...args: Parameters<Fetcher>) => fetch(...args));
    this.esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  }

  async interpretar(claims: SupabaseClaims, dto: ComandoDto): Promise<{ proposal: Record<string, unknown> }> {
    const { apiKey, modelo } = lerConfigRotina().gemini;
    if (!apiKey) throw ERROS.iaNaoConfigurada();
    const command = cleanText(dto.command, 2000);
    if (!command) throw ERROS.comandoFalhou();
    const timezone = cleanText(dto.timezone, 80) || 'America/Sao_Paulo';

    let dados: { clients: Array<{ id: string; label: string }>; properties: Array<{ id: string; label: string; context: string; location: string | null }> };
    try {
      dados = await this.db.run(claims, async (tx) => {
        await exigirContexto(tx, claims.sub);
        // RLS do corretor já restringe ao legacy_corretor_id (contrato §2.5).
        const clientes = await tx.$queryRaw<Array<{ id: string; nome: string }>>(Prisma.sql`
          select id::text as id, nome from public.clientes order by nome limit ${LIMITE_CANDIDATOS}::int`);
        const imoveis = await tx.$queryRaw<Array<{ id: string; titulo: string; bairro: string | null; cidade: string | null; endereco: string | null }>>(Prisma.sql`
          select id::text as id, titulo, bairro, cidade, endereco from public.imoveis where ativo = true order by titulo limit ${LIMITE_CANDIDATOS}::int`);
        return {
          clients: clientes.map((item) => ({ id: item.id, label: item.nome })),
          properties: imoveis.map((item) => ({
            id: item.id,
            label: item.titulo,
            context: [item.bairro, item.cidade].filter(Boolean).join(' · '),
            location: item.endereco || null,
          })),
        };
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      try {
        traduzirErroBanco(e);
      } catch (t) {
        if (t instanceof HttpException) throw t;
      }
      this.logger.error(`routine-command: ${safeErrorCode(e)}`);
      throw ERROS.comandoFalhou();
    }

    try {
      return { proposal: await this.proposta(claims.sub, command, timezone, dados.clients, dados.properties, apiKey, modelo) };
    } catch (e) {
      this.logger.error(`routine-command: ${safeErrorCode(e)}`);
      throw ERROS.comandoFalhou();
    }
  }

  private async chamarModelo(apiKey: string, modelo: string, payload: Record<string, unknown>): Promise<Response> {
    const retries = 1;
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.fetcher(URL_GEMINI, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, model: modelo }),
          signal: AbortSignal.timeout(30_000),
        });
        if (attempt >= retries || !retentavel(response.status)) return response;
        await response.body?.cancel().catch(() => undefined);
      } catch (error) {
        if (attempt >= retries) throw error;
      }
      await this.esperar(250 * (attempt + 1));
    }
  }

  private async proposta(
    userId: string, command: string, timezone: string,
    clients: Array<{ id: string; label: string }>,
    properties: Array<{ id: string; label: string; context: string; location: string | null }>,
    apiKey: string, modelo: string,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const prompt = [
      'Você transforma um comando em uma PROPOSTA de atividade para um CRM imobiliário brasileiro.',
      'Nunca execute ação e nunca invente cliente, imóvel, data ou horário.',
      `Agora em UTC: ${now.toISOString()}. Zona do usuário: ${timezone}.`,
      `Categorias aceitas: ${ACTIVITIES.join(', ')}.`,
      'Retorne somente JSON com: kind(event|task), title, activity_type, start_at, end_at, due_at, client_query, property_query, location, reminder_minutes, priority(low|medium|high|urgent), missing_fields.',
      'Para event, start_at e end_at devem ser ISO 8601 com offset e duração sugerida. Para task use due_at.',
      'Se data ou horário indispensável não existir, use null e inclua o nome em missing_fields.',
      `Clientes disponíveis (id não deve sair no texto): ${clients.map((item) => item.label).join(' | ') || 'nenhum'}.`,
      `Imóveis disponíveis: ${properties.map((item) => `${item.label}${item.context ? ` (${item.context})` : ''}`).join(' | ') || 'nenhum'}.`,
      `Comando: ${command}`,
    ].join('\n');
    const response = await this.chamarModelo(apiKey, modelo, {
      messages: [
        { role: 'system', content: 'Você é o interpretador seguro da Central de Rotina da Lotti.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });
    if (!response.ok) throw new Error(`provider_${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const raw = parseJsonContent(payload.choices?.[0]?.message?.content);
    const kind = raw.kind === 'event' ? 'event' : 'task';
    const activityType = typeof raw.activity_type === 'string' && ACTIVITIES.includes(raw.activity_type) ? raw.activity_type : 'outro';
    const clientQuery = cleanText(raw.client_query);
    const propertyQuery = cleanText(raw.property_query);
    const client = findCandidate(clientQuery, clients);
    const property = findCandidate(propertyQuery, properties);
    const startAt = isoOrNull(raw.start_at);
    const endAt = isoOrNull(raw.end_at);
    const dueAt = isoOrNull(raw.due_at);
    const missing = Array.isArray(raw.missing_fields)
      ? raw.missing_fields.filter((item): item is string => typeof item === 'string').slice(0, 5)
      : [];
    if (kind === 'event' && !startAt && !missing.includes('data')) missing.push('data');
    if (kind === 'event' && !endAt && !missing.includes('horário')) missing.push('horário');
    if (kind === 'event' && startAt && endAt && new Date(endAt) <= new Date(startAt)) throw new Error('invalid_interval');
    const reminder = Number(raw.reminder_minutes);
    const priority = ['low', 'medium', 'high', 'urgent'].includes(String(raw.priority)) ? String(raw.priority) : 'medium';
    return {
      kind,
      title: cleanText(raw.title) || (kind === 'event' ? 'Novo compromisso' : 'Nova tarefa'),
      activity_type: activityType,
      start_at: startAt,
      end_at: endAt,
      due_at: dueAt,
      client_query: clientQuery,
      client_id: client?.id || null,
      property_query: propertyQuery,
      property_id: property?.id || null,
      location: cleanText(raw.location, 500) || property?.location || null,
      assigned_to: userId,
      reminder_minutes: Number.isFinite(reminder) && reminder >= 0 && reminder <= 525600 ? reminder : null,
      priority,
      missing_fields: [...new Set(missing)],
      requires_confirmation: true,
      conflicts: [],
      interpretation_source: 'ai',
    };
  }
}
