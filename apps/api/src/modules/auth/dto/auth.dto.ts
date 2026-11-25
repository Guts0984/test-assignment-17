import { createZodDto } from 'nestjs-zod';
import { loginResponseSchema, loginSchema } from '@hotel/shared';

export class LoginDto extends createZodDto(loginSchema) {}
export class LoginResponseDto extends createZodDto(loginResponseSchema) {}
