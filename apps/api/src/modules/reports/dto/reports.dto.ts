import { createZodDto } from 'nestjs-zod';
import { reportQuerySchema, reportSchema } from '@hotel/shared';

export class ReportQueryDto extends createZodDto(reportQuerySchema) {}
export class ReportDto extends createZodDto(reportSchema) {}
