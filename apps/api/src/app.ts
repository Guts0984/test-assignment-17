import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import express from 'express';
import helmet from 'helmet';
import { patchNestJsSwagger } from 'nestjs-zod';
import { createDb } from '@hotel/db';
import { CHANNEL_INBOUND_QUEUE, HOLD_EXPIRY_QUEUE } from '@hotel/shared';
import { AppModule } from './app.module';
import { bodyErrorHandler } from './common/error.filter';
import { createGeneralLimiter } from './common/rate-limit/middlewares';
import { createFallbackStore, createMemoryStore, createRedisStore } from './common/rate-limit/store';
import type { Env } from './config/env';
import { systemClock } from './infra/clock';
import { createLimiterRedis, createQueueRedis } from './infra/redis';
import { RedisIoAdapter } from './infra/redis-io.adapter';
import type { Clock } from './infra/tokens';
import { describeApi } from './openapi';

export const PUSH_QUEUE = 'channel-push';

export interface CreateAppOptions {
  readonly env: Env;
  readonly clock?: Clock;
  readonly docs?: boolean;
}

/** Builds the real Nest app (used by main.ts and by tests). */
export const createApp = async (opts: CreateAppOptions): Promise<NestExpressApplication> => {
  const { env } = opts;
  const clock = opts.clock ?? systemClock;
  patchNestJsSwagger();
  const redis = createLimiterRedis(env.REDIS_URL);
  const logger = new Logger('RateLimit');
  let warned = false;
  const store = createFallbackStore(createRedisStore(redis), createMemoryStore(clock.now), () => {
    if (!warned) logger.warn('Redis unavailable: limiters use the in-memory store');
    warned = true;
  });
  const db = createDb(env.databaseUrl);
  const queueRedis = createQueueRedis(env.REDIS_URL);
  const pushQueue = new Queue(PUSH_QUEUE, { connection: queueRedis });
  const inboundQueue = new Queue(CHANNEL_INBOUND_QUEUE, { connection: queueRedis });
  const holdQueue = new Queue(HOLD_EXPIRY_QUEUE, { connection: queueRedis });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ env, db, redis, clock, store, pushQueue, inboundQueue, holdQueue }), {
    bodyParser: false,
    logger: [env.LOG_LEVEL],
    cors: { origin: [...env.corsOrigins] },
  });
  app.useWebSocketAdapter(new RedisIoAdapter(app, env.REDIS_URL));
  app.set('trust proxy', [...env.trustedProxies]);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(createGeneralLimiter(store, env.RATE_LIMIT_GLOBAL_PER_MIN));
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(bodyErrorHandler);
  if (opts.docs !== false) {
    const document = describeApi(SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Hotel chain API').setVersion('1.0').addBearerAuth().build()));
    SwaggerModule.setup('docs', app, document);
  }
  app.enableShutdownHooks();
  return app;
};
