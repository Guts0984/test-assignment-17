import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { StaffIdentity } from '../../common/auth/access';
import { Roles } from '../../common/auth/auth.guard';
import { CurrentStaff } from '../../common/auth/current-staff';
import { requireHotel } from '../../common/auth/hotel-access';
import { unwrap } from '../../common/http-error';
import { GridDto, GridQueryDto, SetOverbookingDto, SetRatesDto, SetRestrictionsDto, UpdatedCountDto } from './dto/rates.dto';
import { RatesService } from './rates.service';

@ApiTags('revenue')
@ApiBearerAuth()
@Controller('api/hotels/:hotelId')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Put('rates')
  @Roles('revenue', 'admin')
  @ApiOperation({ operationId: 'setRates', summary: 'Set a price or a percent change on a date range (optionally only some weekdays)' })
  @ApiOkResponse({ type: UpdatedCountDto })
  setRates(@Param('hotelId', ParseUUIDPipe) hotelId: string, @Body() body: SetRatesDto, @CurrentStaff() staff: StaffIdentity) {
    requireHotel(staff, hotelId, ['revenue', 'admin']);
    return this.rates.setRates(hotelId, body);
  }

  @Put('restrictions')
  @Roles('revenue', 'admin')
  @ApiOperation({ operationId: 'setRestrictions', summary: 'Min stay, closed to arrival / departure, stop sell' })
  @ApiOkResponse({ type: UpdatedCountDto })
  setRestrictions(@Param('hotelId', ParseUUIDPipe) hotelId: string, @Body() body: SetRestrictionsDto, @CurrentStaff() staff: StaffIdentity) {
    requireHotel(staff, hotelId, ['revenue', 'admin']);
    return this.rates.setRestrictions(hotelId, body);
  }

  @Put('room-types/:roomTypeId/overbooking')
  @Roles('revenue', 'admin')
  @ApiOperation({ operationId: 'setOverbooking', summary: 'Allowed overbooking per room type (default 0)' })
  @ApiOkResponse({ type: UpdatedCountDto })
  async setOverbooking(
    @Param('hotelId', ParseUUIDPipe) hotelId: string,
    @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string,
    @Body() body: SetOverbookingDto,
    @CurrentStaff() staff: StaffIdentity,
  ) {
    requireHotel(staff, hotelId, ['revenue', 'admin']);
    unwrap(await this.rates.setOverbooking(hotelId, roomTypeId, body.allowance));
    return { updated: 1 };
  }

  @Get('grid')
  @Roles('revenue', 'admin', 'frontdesk')
  @ApiOperation({ operationId: 'getGrid', summary: 'Sold, free, price and restrictions per room type and night' })
  @ApiOkResponse({ type: GridDto })
  grid(@Param('hotelId', ParseUUIDPipe) hotelId: string, @Query() q: GridQueryDto, @CurrentStaff() staff: StaffIdentity) {
    requireHotel(staff, hotelId, ['revenue', 'admin', 'frontdesk']);
    return this.rates.grid(hotelId, q.from, q.days);
  }
}
