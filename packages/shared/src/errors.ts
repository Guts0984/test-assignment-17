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

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  MALFORMED_JSON: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  NO_AVAILABILITY: 409,
  RESTRICTION_VIOLATED: 422,
  HOLD_EXPIRED: 410,
  INVALID_STATUS: 409,
  ROOM_TAKEN: 409,
  ROOM_NOT_READY: 409,
  BALANCE_NOT_ZERO: 409,
  INTERNAL: 500,
};
