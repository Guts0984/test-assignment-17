import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { channelEventResultSchema, channelEventSchema } from '@hotel/shared';
import { Public } from '../../common/auth/auth.guard';
import { unwrap } from '../../common/http-error';
import { ChannelKeyGuard } from './channel-key.guard';
import { ChannelService } from './channel.service';

export class ChannelEventDto extends createZodDto(channelEventSchema) {}
export class ChannelEventResultDto extends createZodDto(channelEventResultSchema) {}

@ApiTags('channel')
@Public()
@UseGuards(ChannelKeyGuard)
@Controller('api/channel')
export class ChannelController {
  constructor(private readonly channel: ChannelService) {}

  @Post('events')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Channel-Key', required: true })
  @ApiOperation({ operationId: 'channelEvent', summary: 'Booking, change or cancel from the sales channel (idempotent per channelRef and version)' })
  @ApiOkResponse({ type: ChannelEventResultDto })
  async event(@Body() body: ChannelEventDto) {
    return unwrap(await this.channel.handle(body));
  }
}
