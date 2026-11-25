import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'MALFORMED_JSON',
  'PAYLOAD_TOO_LARGE',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'CONFLICT',
  'NO_AVAILABILITY',
  'RESTRICTION_VIOLATED',
  'HOLD_EXPIRED',
  'INVALID_STATUS',
  'ROOM_TAKEN',
  'ROOM_NOT_READY',
  'BALANCE_NOT_ZERO',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorResponseSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export interface DomainError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export const domainError = (code: ErrorCode, message: string, details?: unknown): DomainError => ({ code, message, details });
