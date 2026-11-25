import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { StaffIdentity } from '../../common/auth/access';
import { Roles } from '../../common/auth/auth.guard';
import { CurrentStaff } from '../../common/auth/current-staff';
import {
  AssignRoomDto, AssignRoomResultDto, BookingDetailDto, BookingSearchDto, BookingSearchQueryDto, CancelResultDto, CheckOutResultDto, ExtendDto, ExtendResultDto,
  FrontdeskDto, FrontdeskQueryDto, OkDto, ResolveOverbookingDto, ResolveResultDto, RoomOptionsDto,
} from './dto/frontdesk.dto';
import { FrontdeskService } from './frontdesk.service';

const uuidParam = (name: string) => Param(name, ParseUUIDPipe);

@ApiTags('frontdesk')
@ApiBearerAuth()
@Roles('frontdesk', 'admin')
@Controller('api')
export class FrontdeskController {
  constructor(private readonly desk: FrontdeskService) {}

  @Get('hotels/:hotelId/frontdesk')
  @ApiQuery({ name: 'view', required: false, enum: ['arrivals', 'departures', 'inhouse', 'overbooked'] })
  @ApiQuery({ name: 'q', required: false })
  @ApiOperation({ operationId: 'getFrontdesk', summary: 'Arrivals, departures, in-house or overbooked bookings for the hotel date' })
  @ApiOkResponse({ type: FrontdeskDto })
  list(@uuidParam('hotelId') hotelId: string, @Query() q: FrontdeskQueryDto, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.desk(staff, hotelId, q.view, q.q);
  }

  @Get('hotels/:hotelId/bookings/search')
  @ApiQuery({ name: 'q', required: true, description: 'Booking code, surname prefix or e-mail prefix' })
  @ApiOperation({ operationId: 'searchBookings', summary: 'By code, surname or name prefix, or e-mail prefix (at most 50)' })
  @ApiOkResponse({ type: BookingSearchDto })
  search(@uuidParam('hotelId') hotelId: string, @Query() q: BookingSearchQueryDto, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.search(staff, hotelId, q.q);
  }

  @Get('bookings/:id')
  @ApiOperation({ operationId: 'getBooking' })
  @ApiOkResponse({ type: BookingDetailDto })
  get(@uuidParam('id') id: string, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.detail(staff, id);
  }

  @Get('bookings/:id/room-options')
  @ApiOperation({ operationId: 'getRoomOptions', summary: 'Free rooms for the stay: own type and free upgrades' })
  @ApiOkResponse({ type: RoomOptionsDto })
  options(@uuidParam('id') id: string, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.options(staff, id);
  }

  @Post('bookings/:id/assign-room')
  @HttpCode(200)
  @ApiOperation({ operationId: 'assignRoom' })
  @ApiOkResponse({ type: AssignRoomResultDto })
  assign(@uuidParam('id') id: string, @Body() b: AssignRoomDto, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.assign(staff, id, b.roomId);
  }

  @Post('bookings/:id/check-in')
  @HttpCode(200)
  @ApiOperation({ operationId: 'checkInBooking' })
  @ApiOkResponse({ type: OkDto })
  checkIn(@uuidParam('id') id: string, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.checkIn(staff, id);
  }

  @Post('bookings/:id/check-out')
  @HttpCode(200)
  @ApiOperation({ operationId: 'checkOutBooking', summary: 'Needs a zero balance; an early check-out releases the unused nights' })
  @ApiOkResponse({ type: CheckOutResultDto })
  checkOut(@uuidParam('id') id: string, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.checkOut(staff, id);
  }

  @Post('bookings/:id/move-room')
  @HttpCode(200)
  @ApiOperation({ operationId: 'moveRoom', summary: 'Moves a checked-in guest to a clean room for the remaining nights' })
  @ApiOkResponse({ type: OkDto })
  move(@uuidParam('id') id: string, @Body() b: AssignRoomDto, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.move(staff, id, b.roomId);
  }

  @Post('bookings/:id/extend')
  @HttpCode(200)
  @ApiOperation({ operationId: 'extendBooking', summary: 'Adds nights at the current rate; nothing changes if they cannot be taken' })
  @ApiOkResponse({ type: ExtendResultDto })
  extend(@uuidParam('id') id: string, @Body() b: ExtendDto, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.extend(staff, id, b.checkOut);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ operationId: 'cancelBookingByStaff', summary: 'Cancels with the hotel policy penalty' })
  @ApiOkResponse({ type: CancelResultDto })
  cancel(@uuidParam('id') id: string, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.cancel(staff, id);
  }

  @Post('bookings/:id/resolve-overbooking')
  @HttpCode(200)
  @ApiOperation({ operationId: 'resolveOverbooking', summary: 'Moves an overbooked booking to a higher class or another hotel of the chain' })
  @ApiOkResponse({ type: ResolveResultDto })
  resolve(@uuidParam('id') id: string, @Body() b: ResolveOverbookingDto, @CurrentStaff() staff: StaffIdentity) {
    return this.desk.resolve(staff, id, b.roomTypeId, b.hotelId);
  }
}
