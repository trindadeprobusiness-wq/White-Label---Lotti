import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SupabaseClaims } from '../prisma/tenant-db';

export const Claims = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SupabaseClaims => ctx.switchToHttp().getRequest().claims,
);
