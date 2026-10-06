import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { chaveGemini, conteudoIa, FetchImpl, modeloRapido, textoDoConteudo } from './gemini';
import { AnalisarFotoDto, AnalisarFotosImovelDto } from './ia.dto';
import { codigoDe, erroApi, IA_INDISPONIVEL, traduzirErroBanco } from './ia.erros';
import { CATEGORIAS_FOTO, PROMPT_ANALISE_FOTO, PROMPT_FOTOS_IMOVEL, VERSOES_PROMPT_IA } from './prompts';

export interface ParametrosRealce {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  shadows: number;
  highlights: number;
  sharpness: number;
}

export const PARAMETROS_PADRAO: ParametrosRealce = {
  brightness: 1.08,
  contrast: 1.15,
  saturation: 1.1,
  warmth: 5,
  shadows: 15,
  highlights: 10,
  sharpness: 0.4,
};

/** clampParams do analisar-foto. */
export function limitarParametros(p: Partial<ParametrosRealce>): ParametrosRealce {
  return {
    brightness: Math.min(1.3, Math.max(0.8, p.brightness ?? PARAMETROS_PADRAO.brightness)),
    contrast: Math.min(1.4, Math.max(0.85, p.contrast ?? PARAMETROS_PADRAO.contrast)),
    saturation: Math.min(1.35, Math.max(0.85, p.saturation ?? PARAMETROS_PADRAO.saturation)),
    warmth: Math.min(20, Math.max(-20, p.warmth ?? PARAMETROS_PADRAO.warmth)),
    shadows: Math.min(50, Math.max(0, p.shadows ?? PARAMETROS_PADRAO.shadows)),
    highlights: Math.min(40, Math.max(0, p.highlights ?? PARAMETROS_PADRAO.highlights)),
    sharpness: Math.min(1, Math.max(0, p.sharpness ?? PARAMETROS_PADRAO.sharpness)),
  };
}

function comoTexto(v: unknown, max = 300): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

export interface FotoClassificada {
  indice: number;
  categoria: string;
}

/** sanitizar do analisar-fotos-imovel: uma entrada por foto enviada; o que a IA não classificou vira OUTRO. */
export function sanitizarClassificacao(bruto: Record<string, unknown>, total: number) {
  const brutas = Array.isArray(bruto.fotos) ? bruto.fotos : [];
  const porIndice = new Map<number, string>();
  for (const item of brutas) {
    const o = (item ?? {}) as Record<string, unknown>;
    const indice = typeof o.indice === 'number' ? o.indice : Number(o.indice);
    if (!Number.isInteger(indice) || indice < 0 || indice >= total) continue;
    const categoria = comoTexto(o.categoria, 20)?.toUpperCase() ?? '';
    porIndice.set(indice, CATEGORIAS_FOTO.includes(categoria) ? categoria : 'OUTRO');
  }
  const fotos: FotoClassificada[] = [];
  for (let i = 0; i < total; i++) fotos.push({ indice: i, categoria: porIndice.get(i) ?? 'OUTRO' });
  return { fotos, descricao_sugerida: comoTexto(bruto.descricao_sugerida, 1200) };
}

/** Porte de analisar-foto e analisar-fotos-imovel (sem cota, como as funções) e do "Usar a sugestão". */
@Injectable()
export class FotosIaService {
  private readonly log = new Logger('IaFotos');
  /** Injetável para teste; nunca chamado de verdade nos testes. */
  fetchImpl: FetchImpl = (...a) => globalThis.fetch(...a);

  constructor(private readonly db: TenantDb) {}

  /** Resiliente como a função: qualquer falha (inclusive sem chave) devolve os parâmetros padrão. */
  async analisarFoto(dto: AnalisarFotoDto): Promise<{ params: ParametrosRealce }> {
    const chave = chaveGemini();
    if (!chave) return { params: PARAMETROS_PADRAO };
    try {
      const resposta = await conteudoIa({
        chave,
        modelo: modeloRapido(),
        fetchImpl: this.fetchImpl,
        politica: { timeoutMs: 45_000, retries: 1 },
        corpo: {
          contents: [{
            parts: [
              { text: `${PROMPT_ANALISE_FOTO}\n\nPrompt version: ${VERSOES_PROMPT_IA.photoEnhancement}` },
              { inline_data: { mime_type: dto.mimeType, data: dto.imageBase64 } },
            ],
          }],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.2,
            // Sem thinking: o 2.5-flash o liga por padrão e consumia o teto, truncando o JSON.
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 2048,
          },
        },
      });
      if (!resposta.ok) {
        this.log.warn(`IA_FOTO status=${resposta.status}`);
        return { params: PARAMETROS_PADRAO };
      }
      const texto = textoDoConteudo(await resposta.json());
      return { params: limitarParametros(JSON.parse(texto) as Partial<ParametrosRealce>) };
    } catch (e) {
      this.log.warn(`IA_FOTO padrão ${codigoDe(e)}`);
      return { params: PARAMETROS_PADRAO };
    }
  }

  async analisarFotosImovel(dto: AnalisarFotosImovelDto): Promise<{ fotos: FotoClassificada[]; descricao_sugerida: string | null }> {
    const chave = chaveGemini();
    if (!chave) throw IA_INDISPONIVEL();
    const dados = (typeof dto.dados_imovel === 'object' && dto.dados_imovel !== null ? dto.dados_imovel : {}) as Record<string, unknown>;
    const contexto = [
      comoTexto(dados.titulo, 200) && `Título: ${comoTexto(dados.titulo, 200)}`,
      comoTexto(dados.tipo, 40) && `Tipo: ${comoTexto(dados.tipo, 40)}`,
      comoTexto(dados.bairro, 120) && `Bairro: ${comoTexto(dados.bairro, 120)}`,
      comoTexto(dados.cidade, 120) && `Cidade: ${comoTexto(dados.cidade, 120)}`,
      comoTexto(dto.descricao_atual, 2000) && `Descrição atual: ${comoTexto(dto.descricao_atual, 2000)}`,
    ].filter(Boolean).join('\n');

    // Uma chamada com todas as fotos: mais barato e o modelo enxerga o conjunto.
    const versionado = `${PROMPT_FOTOS_IMOVEL}\n\nPrompt version: ${VERSOES_PROMPT_IA.propertyPhotos}`;
    const partes: unknown[] = [{ text: contexto ? `${versionado}\n\nDados do imóvel:\n${contexto}` : versionado }];
    for (const b64 of dto.imagens) partes.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });

    const falhou = () => erroApi(502, 'ia_falhou', 'Falha ao analisar as fotos com a IA');
    let resposta: Response;
    try {
      resposta = await conteudoIa({
        chave,
        modelo: modeloRapido(),
        fetchImpl: this.fetchImpl,
        politica: { timeoutMs: 90_000 },
        corpo: {
          contents: [{ parts: partes }],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.2,
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 4096,
          },
        },
      });
    } catch (e) {
      this.log.error(`IA_FOTOS_IMOVEL rede ${codigoDe(e)}`);
      throw falhou();
    }
    if (!resposta.ok) {
      this.log.error(`IA_FOTOS_IMOVEL status=${resposta.status}`);
      throw falhou();
    }
    let parsed: Record<string, unknown>;
    try {
      const limpo = textoDoConteudo(await resposta.json());
      const ini = limpo.indexOf('{');
      const fim = limpo.lastIndexOf('}');
      parsed = JSON.parse(ini !== -1 && fim > ini ? limpo.slice(ini, fim + 1) : limpo);
    } catch {
      this.log.error('IA_FOTOS_IMOVEL sem JSON');
      throw erroApi(502, 'ia_sem_estrutura', 'A IA não conseguiu estruturar a análise das fotos');
    }
    return sanitizarClassificacao(parsed, dto.imagens.length);
  }

  /** "Usar a sugestão": grava só a descrição, com o RLS do imóvel (o PATCH de imóveis não aceita descricao). */
  async salvarDescricao(claims: SupabaseClaims, imovelId: string, descricao: string): Promise<{ id: string; descricao: string }> {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ id: string; descricao: string }>>(Prisma.sql`
        update public.imoveis set descricao = ${descricao}::text
        where id = ${imovelId}::uuid returning id::text as id, descricao`));
      if (linhas.length === 0) throw erroApi(404, 'imovel_nao_encontrado', 'Imóvel não encontrado.');
      return linhas[0];
    } catch (e) {
      traduzirErroBanco(e, { semPermissao: 'Você não tem permissão para alterar este imóvel.' });
    }
  }
}
