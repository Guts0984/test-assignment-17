import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Db } from '@hotel/db';
import { Public } from '../../common/auth/auth.guard';
import { DB } from '../../infra/tokens';

@ApiTags('health')
@Controller('api/health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get()
  @ApiOperation({ operationId: 'health' })
  async health(): Promise<{ ok: true; time: string }> {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  }
}
