import { CanActivate, ExecutionContext, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppEnv, ENV } from '../config/env';

/** Rotas chamadas pelo agente do WhatsApp, não por um usuário logado. */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.env.agentApiToken;
    if (!expected) throw new ServiceUnavailableException('Integração do agente não configurada.');
    const header = ctx.switchToHttp().getRequest().headers?.['x-lotti-agent'];
    const actual = Buffer.from(typeof header === 'string' ? header : '');
    const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw new UnauthorizedException();
    return true;
  }
}
