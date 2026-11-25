import { CanActivate, ExecutionContext, HttpException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { domainError, ERROR_STATUS, type Role } from '@hotel/shared';
import type { Db } from '@hotel/db';
import { DB, ENV, type EnvValue } from '../../infra/tokens';
import { hasAnyRole, type StaffIdentity } from './access';
import { resolveStaff } from './session';
import type { VerifiedToken } from './token';

export const PUBLIC_KEY = 'public';
export const ROLES_KEY = 'roles';

/** Route needs no staff token (guest, channel, login, health). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);
/** Route needs a staff token holding one of these roles (in any hotel; the hotel is checked per resource). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

export type AuthedRequest = Request & { staff: StaffIdentity; token: VerifiedToken };

const fail = (code: 'UNAUTHORIZED' | 'FORBIDDEN', message: string): HttpException =>
  new HttpException(domainError(code, message), ERROR_STATUS[code]);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: EnvValue,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const session = token ? await resolveStaff(this.db, token, this.env.JWT_SECRET) : null;
    if (!session) throw fail('UNAUTHORIZED', 'A valid access token is required');
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !hasAnyRole(session.staff, roles)) throw fail('FORBIDDEN', 'Your role does not allow this');
    const authed = req as AuthedRequest;
    authed.staff = session.staff;
    authed.token = session.token;
    return true;
  }
}
