import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { StaffIdentity } from '../../common/auth/access';
import { Roles } from '../../common/auth/auth.guard';
import { CurrentStaff } from '../../common/auth/current-staff';
import { HkRoomsDto, HousekeepersDto, OutOfOrderDto, OutOfOrderResultDto, RoomStatusResultDto, SetHousekeeperDto, SetRoomStatusDto } from './dto/housekeeping.dto';
import { HousekeepingService } from './housekeeping.service';

@ApiTags('housekeeping')
@ApiBearerAuth()
@Controller('api')
export class HousekeepingController {
  constructor(private readonly hk: HousekeepingService) {}

  @Get('hotels/:hotelId/housekeeping/rooms')
  @Roles('housekeeper', 'head_housekeeper', 'admin')
  @ApiOperation({ operationId: 'getHousekeepingRooms', summary: 'A housekeeper sees her own rooms; the head and admin see the whole hotel' })
  @ApiOkResponse({ type: HkRoomsDto })
  rooms(@Param('hotelId', ParseUUIDPipe) hotelId: string, @CurrentStaff() staff: StaffIdentity) {
    return this.hk.rooms(staff, hotelId);
  }

  @Get('hotels/:hotelId/housekeepers')
  @Roles('head_housekeeper', 'admin')
  @ApiOperation({ operationId: 'listHousekeepers', summary: 'Housekeepers of the hotel, for distributing rooms' })
  @ApiOkResponse({ type: HousekeepersDto })
  housekeepers(@Param('hotelId', ParseUUIDPipe) hotelId: string, @CurrentStaff() staff: StaffIdentity) {
    return this.hk.housekeepers(staff, hotelId);
  }

  @Post('rooms/:id/status')
  @HttpCode(200)
  @Roles('housekeeper', 'head_housekeeper', 'admin')
  @ApiOperation({ operationId: 'setRoomStatus', summary: 'dirty to clean (own room); clean to inspected and back to dirty (head only)' })
  @ApiOkResponse({ type: RoomStatusResultDto })
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: SetRoomStatusDto, @CurrentStaff() staff: StaffIdentity) {
    return this.hk.setStatus(staff, id, body.status);
  }

  @Put('rooms/:id/housekeeper')
  @Roles('head_housekeeper', 'admin')
  @ApiOperation({ operationId: 'setRoomHousekeeper' })
  @ApiOkResponse({ type: RoomStatusResultDto })
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() body: SetHousekeeperDto, @CurrentStaff() staff: StaffIdentity) {
    return this.hk.setHousekeeper(staff, id, body.housekeeperId);
  }

  @Post('rooms/:id/out-of-order')
  @HttpCode(200)
  @Roles('head_housekeeper', 'admin')
  @ApiOperation({ operationId: 'setRoomOutOfOrder', summary: 'Takes the room out of sale for [from, to) with a reason' })
  @ApiOkResponse({ type: OutOfOrderResultDto })
  outOfOrder(@Param('id', ParseUUIDPipe) id: string, @Body() body: OutOfOrderDto, @CurrentStaff() staff: StaffIdentity) {
    return this.hk.outOfOrder(staff, id, body);
  }

  @Delete('rooms/:id/out-of-order/:oooId')
  @Roles('head_housekeeper', 'admin')
  @ApiOperation({ operationId: 'clearRoomOutOfOrder' })
  @ApiOkResponse({ type: OutOfOrderResultDto })
  clear(@Param('id', ParseUUIDPipe) id: string, @Param('oooId', ParseUUIDPipe) oooId: string, @CurrentStaff() staff: StaffIdentity) {
    return this.hk.endOutOfOrder(staff, id, oooId);
  }
}
