import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { hasRole, type StaffIdentity } from '../../common/auth/access';
import type { Db } from '@hotel/db';
import { resolveStaff } from '../../common/auth/session';
import { DB, ENV, type EnvValue } from '../../infra/tokens';
import { CHANGE_FEEDS, createThrottle, roomName, type ChangeKind } from './domain/channels';
import { startHotelListener } from './pg-listener';

const joinBody = z.object({ hotelId: z.string().uuid() });
const KINDS = Object.keys(CHANGE_FEEDS) as ChangeKind[];

/**
 * Staff sockets. The token is checked on connect; joining a hotel needs a role in THAT hotel, and each feed
 * (grid, front desk, housekeeping) is a separate room only the matching roles can join.
 */
@WebSocketGateway({ path: '/socket.io', cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger('Realtime');
  private stop: (() => Promise<void>) | null = null;

  constructor(
    @Inject(ENV) private readonly env: EnvValue,
    @Inject(DB) private readonly db: Db,
  ) {}

  onModuleInit(): void {
    const throttle = createThrottle(100, Date.now);
    this.stop = startHotelListener(
      this.env.databaseUrl.split('?')[0],
      (change) => {
        const feed = CHANGE_FEEDS[change.kind];
        throttle(`${change.hotelId}:${change.kind}`, () => this.server.local.to(roomName(change.hotelId, change.kind)).emit(feed.event, { hotelId: change.hotelId }));
      },
      (e) => this.logger.warn(`listener: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop?.();
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth as { token?: unknown }).token;
    // the client may send `join` right after it connects, before this check has finished: `join` waits for it
    const pending = typeof token === 'string' ? resolveStaff(this.db, token, this.env.JWT_SECRET) : Promise.resolve(null);
    (client.data as { pending?: Promise<unknown> }).pending = pending;
    const staff = (await pending)?.staff;
    if (!staff) {
      client.emit('error', { code: 'UNAUTHORIZED', message: 'A valid access token is required' });
      client.disconnect(true);
      return;
    }
    (client.data as { staff?: StaffIdentity }).staff = staff;
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<{ ok: boolean; code?: string; joined?: string[] }> {
    await (client.data as { pending?: Promise<unknown> }).pending;
    const staff = (client.data as { staff?: StaffIdentity }).staff;
    const parsed = joinBody.safeParse(body);
    if (!staff) return { ok: false, code: 'UNAUTHORIZED' };
    if (!parsed.success) return { ok: false, code: 'VALIDATION_ERROR' };
    const joined = KINDS.filter((k) => hasRole(staff, parsed.data.hotelId, CHANGE_FEEDS[k].roles));
    if (joined.length === 0) return { ok: false, code: 'FORBIDDEN' };
    for (const k of joined) void client.join(roomName(parsed.data.hotelId, k));
    return { ok: true, joined };
  }
}
