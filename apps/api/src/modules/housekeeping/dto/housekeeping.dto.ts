import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { hkRoomsSchema, outOfOrderResultSchema, outOfOrderSchema, roomStatusResultSchema, setHousekeeperSchema, setRoomStatusSchema } from '@hotel/shared';

export class HkRoomsDto extends createZodDto(hkRoomsSchema) {}
export class SetRoomStatusDto extends createZodDto(setRoomStatusSchema) {}
export class RoomStatusResultDto extends createZodDto(roomStatusResultSchema) {}
export class SetHousekeeperDto extends createZodDto(setHousekeeperSchema) {}
export class OutOfOrderDto extends createZodDto(outOfOrderSchema) {}
export class OutOfOrderResultDto extends createZodDto(outOfOrderResultSchema) {}

export class HousekeepersDto extends createZodDto(z.object({ housekeepers: z.array(z.object({ id: z.string(), name: z.string() })) })) {}
