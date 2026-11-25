import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';
import type { Db } from '@hotel/db';
import { signToken } from '../../common/auth/token';
import type { CounterStore } from '../../common/rate-limit/store';
import { DB, ENV, LIMITER_STORE, type EnvValue } from '../../infra/tokens';
import { createLoginFlow } from './domain/login-flow';
import { findStaffByEmail } from './repo/staff.repo';

@Injectable()
export class AuthService {
  private readonly flow: ReturnType<typeof createLoginFlow>;

  constructor(
    @Inject(DB) db: Db,
    @Inject(ENV) env: EnvValue,
    @Inject(LIMITER_STORE) store: CounterStore,
  ) {
    const dummy = hash(randomBytes(16).toString('hex'));
    this.flow = createLoginFlow({
      store,
      limits: {
        maxPerIpEmail: env.LOGIN_MAX_FAILS_PER_IP_EMAIL,
        maxPerIp: env.LOGIN_MAX_FAILS_PER_IP,
        maxPerEmail: env.LOGIN_MAX_FAILS_PER_EMAIL,
        windowSec: env.LOGIN_FAIL_WINDOW_SEC,
        blockSec: env.LOGIN_BLOCK_SEC,
      },
      findStaff: (email) => findStaffByEmail(db, email),
      verify: (h, p) => verify(h, p).catch(() => false),
      dummyHash: () => dummy,
      sign: (staff) => signToken(staff, env.JWT_SECRET, env.JWT_TTL_SEC),
    });
  }

  login(input: { ip: string; email: string; password: string }) {
    return this.flow.login(input);
  }
}
