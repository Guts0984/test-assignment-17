import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/** Socket.IO with the Redis adapter, so rooms and broadcasts span both api copies. */
export class RedisIoAdapter extends IoAdapter {
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(app: ConstructorParameters<typeof IoAdapter>[0], redisUrl: string) {
    super(app);
    this.pub = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.sub = this.pub.duplicate();
    this.pub.on('error', () => undefined);
    this.sub.on('error', () => undefined);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as { adapter: (a: unknown) => void };
    server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }

  override async close(server: Parameters<IoAdapter['close']>[0]): Promise<void> {
    await super.close(server);
    this.pub.disconnect();
    this.sub.disconnect();
  }
}
