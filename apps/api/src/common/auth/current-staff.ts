import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from './auth.guard';
import type { StaffIdentity } from './access';

export const CurrentStaff = createParamDecorator((_data: unknown, ctx: ExecutionContext): StaffIdentity => ctx.switchToHttp().getRequest<AuthedRequest>().staff);
