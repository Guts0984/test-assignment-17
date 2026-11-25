import { createZodDto } from 'nestjs-zod';
import {
  assignRoomResultSchema, assignRoomSchema, bookingDetailSchema, bookingSearchQuerySchema, bookingSearchSchema, cancelResultSchema, checkOutResultSchema,
  extendResultSchema, extendSchema, frontdeskQuerySchema, frontdeskSchema, okSchema, resolveOverbookingSchema, resolveResultSchema, roomOptionsSchema,
} from '@hotel/shared';

export class FrontdeskQueryDto extends createZodDto(frontdeskQuerySchema) {}
export class FrontdeskDto extends createZodDto(frontdeskSchema) {}
export class BookingSearchQueryDto extends createZodDto(bookingSearchQuerySchema) {}
export class BookingSearchDto extends createZodDto(bookingSearchSchema) {}
export class BookingDetailDto extends createZodDto(bookingDetailSchema) {}
export class RoomOptionsDto extends createZodDto(roomOptionsSchema) {}
export class AssignRoomDto extends createZodDto(assignRoomSchema) {}
export class AssignRoomResultDto extends createZodDto(assignRoomResultSchema) {}
export class ExtendDto extends createZodDto(extendSchema) {}
export class ExtendResultDto extends createZodDto(extendResultSchema) {}
export class ResolveOverbookingDto extends createZodDto(resolveOverbookingSchema) {}
export class ResolveResultDto extends createZodDto(resolveResultSchema) {}
export class CheckOutResultDto extends createZodDto(checkOutResultSchema) {}
export class CancelResultDto extends createZodDto(cancelResultSchema) {}
export class OkDto extends createZodDto(okSchema) {}
