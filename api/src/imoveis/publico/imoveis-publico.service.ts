import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  Consulta, erroVitrine, lerFiltrosVitrine, lerIdDetalhe, MSG_FALHA_CARGA, MSG_FALHA_GENERICA, MSG_NAO_DISPONIVEL,
  normalizarDetalhe, normalizarVitrine,
} from './imoveis-publico.regras';
import { ImoveisPublicoRepo } from './imoveis-publico.repo';

/**
 * Porte das Edge Functions public-imoveis e imovel-detalhe. Mesmas entradas (query string), mesma
 * resposta e os mesmos erros `{ error }`. Erro de banco nunca chega ao site: vira o texto genérico.
 */
@Injectable()
export class ImoveisPublicoService {
  private readonly logger = new Logger('ImoveisPublico');

  constructor(private readonly repo: ImoveisPublicoRepo) {}

  async listar(consulta: Consulta) {
    const filtros = lerFiltrosVitrine(consulta);
    let resultado;
    try {
      resultado = await this.repo.listarVitrine(filtros);
    } catch {
      this.logger.error('vitrine pública: falha ao ler o banco');
      throw erroVitrine(500, MSG_FALHA_CARGA);
    }
    return {
      data: resultado.imoveis.map((linha) => normalizarVitrine(linha, filtros.tipo)),
      total: resultado.total || 0,
      limit: filtros.limit,
      offset: filtros.offset,
    };
  }

  async detalhe(consulta: Consulta) {
    const id = lerIdDetalhe(consulta);
    try {
      const r = await this.repo.detalhe(id);
      if (!r) throw erroVitrine(404, MSG_NAO_DISPONIVEL);
      return normalizarDetalhe(r.imovel, r.similares ?? []);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error('detalhe público: falha ao ler o banco');
      throw erroVitrine(500, MSG_FALHA_GENERICA);
    }
  }
}
