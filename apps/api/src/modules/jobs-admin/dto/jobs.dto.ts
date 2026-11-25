import { createZodDto } from 'nestjs-zod';
import { failedJobsSchema, okSchema } from '@hotel/shared';

export class FailedJobsDto extends createZodDto(failedJobsSchema) {}
export class JobRetriedDto extends createZodDto(okSchema) {}
