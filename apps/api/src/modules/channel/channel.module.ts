import { Inject, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { createChannelLimiter } from '../../common/rate-limit/middlewares';
import type { CounterStore } from '../../common/rate-limit/store';
import { ENV, LIMITER_STORE, type EnvValue } from '../../infra/tokens';
import { ChannelController } from './channel.controller';
import { keyDigest } from './channel-key.guard';
import { ChannelService } from './channel.service';

@Module({ controllers: [ChannelController], providers: [ChannelService] })
export class ChannelModule implements NestModule {
  constructor(
    @Inject(LIMITER_STORE) private readonly store: CounterStore,
    @Inject(ENV) private readonly env: EnvValue,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    const key = (req: { headers: Record<string, string | string[] | undefined> }): string => {
      const h = req.headers['x-channel-key'];
      return keyDigest(typeof h === 'string' ? h : '').toString('hex');
    };
    consumer.apply(createChannelLimiter(this.store, this.env.CHANNEL_RATE_PER_MIN, key)).forRoutes('api/channel');
  }
}
