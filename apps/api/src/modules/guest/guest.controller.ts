import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/auth/auth.guard';
import { unwrap } from '../../common/http-error';
import {
  BookingViewDto, ChangeBookingDto, ConfirmHoldDto, ConfirmResponseDto, CreateHoldDto, HoldResponseDto, HotelListDto, SearchQueryDto, SearchResultDto,
} from './dto/guest.dto';
import { GuestService } from './guest.service';

@ApiTags('guest')
@Public()
@Controller('api')
export class GuestController {
  constructor(private readonly guest: GuestService) {}

  @Get('hotels')
  @ApiOperation({ operationId: 'listHotels' })
  @ApiOkResponse({ type: HotelListDto })
  hotels() {
    return this.guest.hotels();
  }

  @Get('search')
  @ApiOperation({ operationId: 'search', summary: 'Available room types with the price for the whole stay and per night' })
  @ApiQuery({ name: 'hotelId', required: true })
  @ApiQuery({ name: 'checkIn', required: true, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'checkOut', required: true, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'guests', required: true, type: Number })
  @ApiOkResponse({ type: SearchResultDto })
  async search(@Query() q: SearchQueryDto) {
    return unwrap(await this.guest.search(q));
  }

  @Post('holds')
  @ApiOperation({ operationId: 'createHold', summary: 'Hold a room for 10 minutes (all nights or none)' })
  @ApiOkResponse({ type: HoldResponseDto })
  async hold(@Body() body: CreateHoldDto) {
    return unwrap(await this.guest.hold(body));
  }

  @Post('holds/:token/confirm')
  @HttpCode(200)
  @ApiOperation({ operationId: 'confirmHold' })
  @ApiOkResponse({ type: ConfirmResponseDto })
  async confirm(@Param('token') token: string, @Body() body: ConfirmHoldDto, @Req() req: Request) {
    return unwrap(await this.guest.confirm(req, token, body));
  }

  @Get('manage/:token')
  @ApiOperation({ operationId: 'getManagedBooking', summary: 'Booking by its secret link, with the cancellation penalty preview' })
  @ApiOkResponse({ type: BookingViewDto })
  async view(@Param('token') token: string, @Req() req: Request) {
    return this.guest.render(await this.guest.lookup(req, token));
  }

  @Patch('manage/:token')
  @ApiOperation({ operationId: 'changeManagedBooking' })
  @ApiOkResponse({ type: BookingViewDto })
  async change(@Param('token') token: string, @Body() body: ChangeBookingDto, @Req() req: Request) {
    return unwrap(await this.guest.change(req, token, body));
  }

  @Post('manage/:token/cancel')
  @HttpCode(200)
  @ApiOperation({ operationId: 'cancelManagedBooking' })
  @ApiOkResponse({ type: BookingViewDto })
  async cancel(@Param('token') token: string, @Req() req: Request) {
    return unwrap(await this.guest.cancel(req, token));
  }
}
