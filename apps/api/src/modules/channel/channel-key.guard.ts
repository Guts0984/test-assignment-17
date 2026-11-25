import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { domainError, ERROR_STATUS } from '@hotel/shared';
import { ENV, type EnvValue } from '../../infra/tokens';

export const keyDigest = (key: string): Buffer => createHash('sha256').update(key).digest();

/** X-Channel-Key must equal CHANNEL_API_KEY. Digests are compared in constant time. */
@Injectable()
export class ChannelKeyGuard implements CanActivate {
  private readonly expected: Buffer;
  constructor(@Inject(ENV) env: EnvValue) {
    this.expected = keyDigest(env.CHANNEL_API_KEY);
  }
  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.switchToHttp().getRequest<Request>().headers['x-channel-key'];
    const given = typeof header === 'string' ? header : '';
    if (!timingSafeEqual(keyDigest(given), this.expected)) {
      throw new HttpException(domainError('UNAUTHORIZED', 'A valid X-Channel-Key is required'), ERROR_STATUS.UNAUTHORIZED);
    }
    return true;
  }
}
