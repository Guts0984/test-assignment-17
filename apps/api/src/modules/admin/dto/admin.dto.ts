import { createZodDto } from 'nestjs-zod';
import {
  createHotelSchema, createRoomSchema, createRoomTypeSchema, createStaffSchema, hotelSchema, roomSchema, roomTypeSchema, setChannelResultSchema, setChannelSchema, changeChannelSchema,
  staffListSchema, staffSchema, updateHotelSchema, updateStaffSchema,
} from '@hotel/shared';

export class CreateHotelDto extends createZodDto(createHotelSchema) {}
export class UpdateHotelDto extends createZodDto(updateHotelSchema) {}
export class HotelDto extends createZodDto(hotelSchema) {}
export class CreateRoomTypeDto extends createZodDto(createRoomTypeSchema) {}
export class RoomTypeDto extends createZodDto(roomTypeSchema) {}
export class CreateRoomDto extends createZodDto(createRoomSchema) {}
export class RoomDto extends createZodDto(roomSchema) {}
export class CreateStaffDto extends createZodDto(createStaffSchema) {}
export class UpdateStaffDto extends createZodDto(updateStaffSchema) {}
export class StaffDto extends createZodDto(staffSchema) {}
export class StaffListDto extends createZodDto(staffListSchema) {}
export class SetChannelDto extends createZodDto(setChannelSchema) {}
export class SetChannelResultDto extends createZodDto(setChannelResultSchema) {}
export class ChangeChannelDto extends createZodDto(changeChannelSchema) {}
