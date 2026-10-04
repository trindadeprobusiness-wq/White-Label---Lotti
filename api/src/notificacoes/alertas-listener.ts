import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Client } from 'pg';
import { AppEnv, ENV } from '../config/env';
import { AlertasHub } from './alertas-hub';

/** O mínimo do cliente pg que o listener usa (permite testar sem banco). */
export interface ClienteAviso {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
  on(evento: 'notification', fn: (m: { channel: string; payload?: string }) => void): unknown;
  on(evento: 'error' | 'end', fn: (...args: unknown[]) => void): unknown;
  removeAllListeners(): unknown;
}
export type FabricaCliente = (url: string) => ClienteAviso;
export const FABRICA_CLIENTE = Symbol('FABRICA_CLIENTE');

const CANAL = 'lotti_alertas';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Escuta o canal lotti_alertas (gatilho da migration 20261004233000) numa
 * conexão de sessão (DIRECT_URL: o pooler de transação não guarda LISTEN) e
 * repassa o id do corretor para o hub. Se a conexão cai, reconecta com espera
 * crescente; enquanto isso o front segue com a sondagem de sempre.
 */
@Injectable()
export class AlertasListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertasListener.name);
  private readonly fabrica: FabricaCliente;
  private cliente?: ClienteAviso;
  private parado = false;
  private tentativa = 0;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    private readonly hub: AlertasHub,
    @Optional() @Inject(FABRICA_CLIENTE) fabrica?: FabricaCliente,
  ) {
    this.fabrica = fabrica ?? ((url) => new Client({ connectionString: url }) as unknown as ClienteAviso);
  }

  onModuleInit(): void {
    if (!this.env.directUrl) {
      this.logger.warn('DIRECT_URL ausente: sino ao vivo desligado (o front segue pela sondagem).');
      return;
    }
    void this.conectar();
  }

  async conectar(): Promise<void> {
    if (this.parado || !this.env.directUrl) return;
    const cliente = this.fabrica(this.env.directUrl);
    this.cliente = cliente;
    cliente.on('notification', (m) => {
      if (m.channel === CANAL && UUID.test(m.payload ?? '')) this.hub.avisar(m.payload as string);
    });
    const cair = () => this.reconectar(cliente);
    cliente.on('error', cair);
    cliente.on('end', cair);
    try {
      await cliente.connect();
      await cliente.query(`LISTEN ${CANAL}`);
      this.tentativa = 0;
      this.logger.log(`escutando ${CANAL}`);
    } catch {
      this.reconectar(cliente);
    }
  }

  private reconectar(cliente: ClienteAviso): void {
    if (this.parado || this.cliente !== cliente) return;
    this.cliente = undefined;
    this.descartar(cliente);
    const espera = Math.min(30_000, 1000 * 2 ** this.tentativa++);
    this.logger.warn(`conexão do sino caiu; nova tentativa em ${espera} ms`);
    this.timer = setTimeout(() => void this.conectar(), espera);
    this.timer.unref?.();
  }

  private descartar(cliente: ClienteAviso): void {
    cliente.removeAllListeners();
    cliente.on('error', () => undefined); // erro tardio de um cliente descartado não derruba o processo
    void cliente.end().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    this.parado = true;
    clearTimeout(this.timer);
    const cliente = this.cliente;
    this.cliente = undefined;
    if (cliente) this.descartar(cliente);
  }
}
