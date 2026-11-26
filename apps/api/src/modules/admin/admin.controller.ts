import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { StaffIdentity } from '../../common/auth/access';
import { Roles } from '../../common/auth/auth.guard';
import { CurrentStaff } from '../../common/auth/current-staff';
import { AdminService } from './admin.service';
import {
  ChangeChannelDto, CreateHotelDto, CreateRoomDto, CreateRoomTypeDto, CreateStaffDto, HotelDto, RoomDto, RoomTypeDto, SetChannelDto, SetChannelResultDto, StaffDto, StaffListDto, UpdateHotelDto, UpdateStaffDto,
} from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('api/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('hotels')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createHotel' })
  @ApiOkResponse({ type: HotelDto })
  createHotel(@Body() b: CreateHotelDto, @CurrentStaff() staff: StaffIdentity) {
    return this.admin.createHotel(staff, b);
  }

  @Put('hotels/:id')
  @ApiOperation({ operationId: 'updateHotel' })
  @ApiOkResponse({ type: HotelDto })
  updateHotel(@Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateHotelDto, @CurrentStaff() staff: StaffIdentity) {
    return this.admin.updateHotel(staff, id, b);
  }

  @Post('hotels/:id/room-types')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createRoomType' })
  @ApiOkResponse({ type: RoomTypeDto })
  createRoomType(@Param('id', ParseUUIDPipe) id: string, @Body() b: CreateRoomTypeDto, @CurrentStaff() staff: StaffIdentity) {
    return this.admin.createRoomType(staff, id, b);
  }

  @Post('hotels/:id/rooms')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createRoom' })
  @ApiOkResponse({ type: RoomDto })
  createRoom(@Param('id', ParseUUIDPipe) id: string, @Body() b: CreateRoomDto, @CurrentStaff() staff: StaffIdentity) {
    return this.admin.createRoom(staff, id, b);
  }

  @Get('staff')
  @ApiOperation({ operationId: 'listStaff' })
  @ApiOkResponse({ type: StaffListDto })
  listStaff(@CurrentStaff() staff: StaffIdentity) {
    return this.admin.listStaff(staff);
  }

  @Post('staff')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createStaff', summary: 'Password is stored as argon2id; roles are per hotel' })
  @ApiOkResponse({ type: StaffDto })
  createStaff(@Body() b: CreateStaffDto, @CurrentStaff() staff: StaffIdentity) {
    return this.admin.createStaff(staff, b);
  }

  @Put('staff/:id')
  @ApiOperation({ operationId: 'updateStaff' })
  @ApiOkResponse({ type: StaffDto })
  updateStaff(@Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateStaffDto, @CurrentStaff() staff: StaffIdentity) {
    return this.admin.updateStaff(staff, id, b);
  }

  @Get('channel')
  @ApiOperation({ operationId: 'getChannelRoomTypes', summary: 'Room types currently sold through the channel' })
  @ApiOkResponse({ type: SetChannelResultDto })
  getChannel(@CurrentStaff() staff: StaffIdentity) {
    return this.admin.getChannel(staff);
  }

  @Patch('channel')
  @ApiOperation({ operationId: 'changeChannelRoomTypes', summary: 'Connects and disconnects single room types (add / remove) without rewriting the list' })
  @ApiOkResponse({ type: SetChannelResultDto })
  changeChannel(@Body() b: ChangeChannelDto, @CurrentStaff() staff: StaffIdentity) {
    return this.admin.changeChannel(staff, b.add, b.remove);
  }

  @Put('channel')
  @ApiOperation({ operationId: 'setChannelRoomTypes', summary: 'Replaces the room types sold through the channel' })
  @ApiOkResponse({ type: SetChannelResultDto })
  setChannel(@Body() b: SetChannelDto, @CurrentStaff() staff: StaffIdentity) {
    return this.admin.setChannel(staff, b.roomTypeIds);
  }
}
