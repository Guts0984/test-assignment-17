import type { Db } from '@hotel/db';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env';

export const ENV = Symbol('ENV');
export const DB = Symbol('DB');
export const REDIS = Symbol('REDIS');
export const CLOCK = Symbol('CLOCK');
export const LIMITER_STORE = Symbol('LIMITER_STORE');
export const QUEUE = Symbol('QUEUE');
export const INBOUND_QUEUE = Symbol('INBOUND_QUEUE');
export const HOLD_QUEUE = Symbol('HOLD_QUEUE');

export interface Clock {
  readonly now: () => Date;
}

export type EnvValue = Env;
export type DbValue = Db;
export type RedisValue = Redis;
