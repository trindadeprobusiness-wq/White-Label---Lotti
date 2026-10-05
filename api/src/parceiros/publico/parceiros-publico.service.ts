import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClaims } from '../../prisma/tenant-db';
import { lerConfigParceiros } from '../parceiros.config';
import { AtribuirDto, CliqueDto } from '../parceiros.dto';
import { erroPg, ERROS } from '../parceiros.erros';
import { ParceirosPublicoRepo } from './parceiros-publico.repo';
import { Cabecalhos, hashIp, ipDoRequest, limparUtm, motivoDeInvalidez, truncar } from './utilitarios';

export interface RespostaClique {
  ok: boolean;
  parceiro_nome?: string;
}

export interface RespostaAtribuicao {
  ok: boolean;
  parceiro_nome?: string;
  ja_atribuido?: true;
}

/**
 * Porte de parceiro-clique (P1) e parceiro-atribuir (T1).
 *
 * As duas são "melhor esforço": nunca quebram a visita nem o login. Erro inesperado responde
 * 200 { ok: false } e vai para o log sem nenhum dado pessoal (só SQLSTATE e o nome da rota).
 */
@Injectable()
export class ParceirosPublicoService {
  private readonly logger = new Logger('Parceiros');

  constructor(private readonly repo: ParceirosPublicoRepo) {}

  /** Só SQLSTATE: nunca nome, e-mail, ip_hash, user_agent nem meta.message. */
  private log(rota: string, e: unknown): void {
    this.logger.warn(`${rota}: falha (${erroPg(e)?.sqlstate ?? 'erro'})`);
  }

  async registrarClique(dto: CliqueDto, cabecalhos: Cabecalhos): Promise<RespostaClique> {
    const config = lerConfigParceiros();
    const origem = typeof cabecalhos?.origin === 'string' ? cabecalhos.origin : null;
    // A trava no handler protege também chamada direta; o CORS só protege navegador (contrato §6.9).
    if (origem && config.origensPermitidas.length > 0 && !config.origensPermitidas.includes(origem)) {
      throw ERROS.origemNaoPermitida();
    }
    try {
      const link = await this.repo.resolverLink(dto.slug);
      // Resposta idêntica para slug inexistente, link revogado e parceiro inativo: não dá para
      // descobrir quais slugs existem testando um por um.
      if (!link) return { ok: false };

      const ipHash = hashIp(ipDoRequest(cabecalhos), config.ipHashSalt);
      try {
        await this.repo.registrarClique({
          linkId: link.link_id,
          parceiroId: link.parceiro_id,
          visitanteId: dto.visitante_id,
          ipHash,
          userAgent: truncar(cabecalhos?.['user-agent'], 400),
          referer: truncar(dto.referer ?? cabecalhos?.referer, 400),
          utm: limparUtm(dto.utm),
        });
      } catch (e) {
        // Falhar em gravar o clique não pode impedir a visita: a métrica é secundária.
        this.log('clique', e);
      }

      const janela = link.janela_atribuicao_dias ?? 90;
      try {
        await this.repo.registrarAtribuicao(link.parceiro_id, link.link_id, dto.visitante_id, janela);
      } catch (e) {
        this.log('clique/atribuicao', e);
      }

      // Só o nome, para a faixa "Você chegou pela indicação de X". parceiro_id e percentual jamais saem.
      return { ok: true, parceiro_nome: link.nome };
    } catch (e) {
      this.log('clique', e);
      return { ok: false };
    }
  }

  async reivindicarAtribuicao(claims: SupabaseClaims, dto: AtribuirDto): Promise<RespostaAtribuicao> {
    const uid = claims.sub;
    try {
      // Já atribuído: sucesso silencioso. O app chama a cada login, e a segunda chamada é o esperado.
      if (await this.repo.atribuicaoDoUsuario(uid)) return { ok: true, ja_atribuido: true };

      const atribuicao = await this.repo.atribuicaoDoVisitante(dto.visitante_id);
      if (!atribuicao || atribuicao.user_id || atribuicao.status !== 'pendente') return { ok: false };

      const corretor = await this.repo.corretorDoUsuario(uid);
      const motivo = motivoDeInvalidez({
        statusParceiro: atribuicao.parceiro_status,
        expiraEm: atribuicao.expira_em,
        emailParceiro: atribuicao.parceiro_email,
        emailCorretor: corretor?.email ?? (typeof claims.email === 'string' ? claims.email : null) ?? null,
        userIdParceiro: atribuicao.parceiro_user_id,
        userIdCorretor: uid,
      });
      if (motivo) {
        await this.repo.invalidar(atribuicao.id, motivo);
        return { ok: false };
      }

      const convertida = await this.repo.converter(atribuicao.id, uid, corretor?.id ?? null);
      if (!convertida) return { ok: false };
      return { ok: true, parceiro_nome: atribuicao.nome };
    } catch (e) {
      // 23505 aqui = outra conta ganhou a corrida pelo mesmo visitante.
      this.log('atribuicao', e);
      return { ok: false };
    }
  }
}
