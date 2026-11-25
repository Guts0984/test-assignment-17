import { createZodDto } from 'nestjs-zod';
import { gridQuerySchema, gridSchema, setOverbookingSchema, setRatesSchema, setRestrictionsSchema, updatedCountSchema } from '@hotel/shared';

export class SetRatesDto extends createZodDto(setRatesSchema) {}
export class SetRestrictionsDto extends createZodDto(setRestrictionsSchema) {}
export class SetOverbookingDto extends createZodDto(setOverbookingSchema) {}
export class UpdatedCountDto extends createZodDto(updatedCountSchema) {}
export class GridQueryDto extends createZodDto(gridQuerySchema) {}
export class GridDto extends createZodDto(gridSchema) {}
