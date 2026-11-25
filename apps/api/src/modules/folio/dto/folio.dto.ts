import { createZodDto } from 'nestjs-zod';
import { folioLineInputSchema, folioSchema, okSchema } from '@hotel/shared';

export class FolioLineInputDto extends createZodDto(folioLineInputSchema) {}
export class FolioDto extends createZodDto(folioSchema) {}
export class FolioOkDto extends createZodDto(okSchema) {}
