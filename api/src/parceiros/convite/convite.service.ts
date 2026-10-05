import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import { lerConfigParceiros } from '../parceiros.config';
import { ConviteDto } from '../parceiros.dto';
import { erroPg, ERROS, traduzirErroBanco } from '../parceiros.erros';
import { DadosDoConvite, PORTA_CONVITE, PortaDeConvite } from './porta-convite';

export interface RespostaConvite {
  ok: boolean;
  parceiro_id?: string;
  email?: string;
  email_enviado?: boolean;
  existing_account?: true;
  error?: string;
}

interface Parceiro {
  id: string;
  nome: string;
  email: string;
  status: string;
  user_id: string | null;
  convite_status: string;
}

interface Termos {
  percentual: number | null;
  base_calculo: string | null;
  valor_fixo: number | null;
  teto_renovacoes: number | null;
}

const MENSAGEM_SEM_ENVIO = 'Cadastro salvo. O envio de convites por e-mail ainda não está configurado no servidor.';

/**
 * Porte de parceiro-convidar (T4).
 *
 * Tudo o que não é envio de e-mail roda no TenantDb: as RPCs e as policies já exigem admin, então a
 * API não chama is_admin() por fora. O envio fica atrás da PortaDeConvite, e a falha nunca conta POR
 * QUE falhou: mensagem única para o operador, detalhe só em log e sem dado pessoal (§0.6.10).
 */
@Injectable()
export class ConviteService {
  private readonly logger = new Logger('Parceiros');

  constructor(private readonly db: TenantDb, @Inject(PORTA_CONVITE) private readonly porta: PortaDeConvite) {}

  async convidar(claims: SupabaseClaims, dto: ConviteDto): Promise<RespostaConvite> {
    const config = lerConfigParceiros();
    const criar = dto.acao === 'criar';
    const { parceiro, termos, slug } = await this.preparar(claims, dto, criar);
    const comissao = termos?.base_calculo === 'valor_fixo'
      ? `R$ ${Number(termos.valor_fixo ?? 0).toFixed(2)}`
      : `${Number(termos?.percentual ?? 0)}%`;
    const regra = termos?.base_calculo === 'primeiro_pagamento'
      ? 'Somente o primeiro pagamento de cada indicado gera comissão.'
      : termos?.teto_renovacoes == null
        ? 'A comissão também vale para as renovações enquanto esta regra estiver vigente.'
        : `A comissão vale para o primeiro pagamento e até ${termos.teto_renovacoes} renovações por indicado.`;

    const dados: DadosDoConvite = {
      email: parceiro.email,
      redirectTo: config.portalUrl,
      metadados: {
        tipo_acesso: 'parceiro',
        parceiro_id: parceiro.id,
        nome_parceiro: parceiro.nome,
        comissao,
        regra_renovacao: regra,
        link_parceiro: slug ? `${config.appUrl}/r/${slug}` : '',
      },
      // Só o dado do banco decide, não o texto do erro do provedor (contrato §6.5).
      contaExistente: parceiro.user_id !== null,
    };

    let resultado;
    try {
      resultado = await this.porta.enviarConvite(dados);
    } catch (e) {
      this.logger.warn(`convite: envio recusado (${e instanceof HttpException ? String((e.getResponse() as { codigo?: string }).codigo) : 'erro'})`);
      await this.marcarFalhou(claims, parceiro.id);
      // Reenvio puro precisa do 503 explícito que o botão "Reenviar convite" mostra; quando houve
      // cadastro nesta chamada, o cadastro não pode ser perdido porque o e-mail não saiu.
      if (!criar) throw e instanceof HttpException ? e : ERROS.provedorDeEmailNaoConfigurado();
      return { ok: false, parceiro_id: parceiro.id, email_enviado: false, error: MENSAGEM_SEM_ENVIO };
    }

    try {
      await this.db.run(claims, (tx) => tx.$executeRaw(Prisma.sql`
        update public.parceiros set user_id = coalesce(${resultado.userId}::uuid, user_id),
          convidado_em = now(), convite_status = 'enviado'
         where id = ${parceiro.id}::uuid`));
    } catch (e) {
      traduzirErroBanco(e);
    }
    return resultado.contaExistente
      ? { ok: true, email: parceiro.email, parceiro_id: parceiro.id, existing_account: true }
      : { ok: true, email: parceiro.email, parceiro_id: parceiro.id };
  }

  /** Cria (quando pedido), carrega o parceiro e lê termos e link principal. */
  private async preparar(
    claims: SupabaseClaims, dto: ConviteDto, criar: boolean,
  ): Promise<{ parceiro: Parceiro; termos: Termos | null; slug: string | null }> {
    try {
      return await this.db.run(claims, async (tx) => {
        let id = dto.parceiro_id ?? '';
        if (criar) {
          const r = await tx.$queryRaw<Array<{ resultado: { parceiro_id?: string } | null }>>(Prisma.sql`
            select public.admin_criar_parceiro_completo(${dto.dados ?? {}}::jsonb) as resultado`);
          const novo = r[0]?.resultado?.parceiro_id;
          if (!novo) throw ERROS.naoEncontrado();
          id = novo;
        }
        const linhas = await tx.$queryRaw<Parceiro[]>(Prisma.sql`
          select id::text as id, nome, email, status, user_id::text as user_id, convite_status
            from public.parceiros where id = ${id}::uuid`);
        const parceiro = linhas[0];
        if (!parceiro) throw ERROS.naoEncontrado();
        if (parceiro.status !== 'ativo') throw ERROS.parceiroInativo();
        if (parceiro.convite_status === 'aceito') throw ERROS.conviteJaAceito();

        const termos = await tx.$queryRaw<Termos[]>(Prisma.sql`
          select percentual::float8 as percentual, base_calculo, valor_fixo::float8 as valor_fixo, teto_renovacoes
            from public.parceiro_percentuais
           where parceiro_id = ${parceiro.id}::uuid and vigencia_fim is null limit 1`);
        const link = await tx.$queryRaw<Array<{ slug: string }>>(Prisma.sql`
          select slug from public.parceiro_links
           where parceiro_id = ${parceiro.id}::uuid and principal and ativo and revogado_em is null limit 1`);
        return { parceiro, termos: termos[0] ?? null, slug: link[0]?.slug ?? null };
      });
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  /** Melhor esforço, em run próprio depois do primeiro confirmado: erro só em log. */
  private async marcarFalhou(claims: SupabaseClaims, id: string): Promise<void> {
    try {
      await this.db.run(claims, (tx) => tx.$executeRaw(Prisma.sql`
        update public.parceiros set convite_status = 'falhou' where id = ${id}::uuid`));
    } catch (e) {
      this.logger.warn(`convite: convite_status não atualizado (${erroPg(e)?.sqlstate ?? 'erro'})`);
    }
  }
}
