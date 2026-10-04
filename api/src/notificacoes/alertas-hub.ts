import { Injectable } from '@nestjs/common';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';

export interface EventoSino {
  data: { tipo: 'alertas' | 'ping' };
}

/**
 * Distribui os avisos de mudança em alertas para quem está conectado ao sino.
 * O aviso só diz "mudou"; o front relê a lista pela API (com o RLS de quem está
 * logado), como já faz hoje com o Realtime do Supabase.
 */
@Injectable()
export class AlertasHub {
  /** Batida para proxies não fecharem a conexão parada. */
  batimentoMs = 25_000;
  private readonly mudancas = new Subject<string>();

  avisar(corretorId: string): void {
    this.mudancas.next(corretorId);
  }

  observar(corretorId: string): Observable<EventoSino> {
    return merge(
      this.mudancas.pipe(filter((id) => id === corretorId), map(() => ({ data: { tipo: 'alertas' as const } }))),
      interval(this.batimentoMs).pipe(map(() => ({ data: { tipo: 'ping' as const } }))),
    );
  }
}
