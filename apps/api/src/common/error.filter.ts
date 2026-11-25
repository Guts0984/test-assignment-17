import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ERROR_CODES, ERROR_STATUS, type ErrorCode, type ErrorResponse } from '@hotel/shared';

const isCode = (v: unknown): v is ErrorCode => typeof v === 'string' && (ERROR_CODES as readonly string[]).includes(v);

export const toErrorResponse = (exception: unknown): { status: number; body: ErrorResponse } => {
  if (exception instanceof ZodValidationException) {
    const issues = exception.getZodError().issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return { status: 400, body: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: { issues } } };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    if (typeof res === 'object' && res !== null && isCode((res as { code?: unknown }).code)) {
      const r = res as ErrorResponse;
      return { status, body: { code: r.code, message: r.message, ...(r.details === undefined ? {} : { details: r.details }) } };
    }
    const code: ErrorCode = status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' : 'VALIDATION_ERROR';
    return { status, body: { code, message: exception.message } };
  }
  return { status: 500, body: { code: 'INTERNAL', message: 'Something went wrong' } };
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = toErrorResponse(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    const retry = (body.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
    if (body.code === 'RATE_LIMITED' && typeof retry === 'number') res.setHeader('Retry-After', String(retry));
    res.status(status ?? ERROR_STATUS[body.code]).json(body);
  }
}

/** A NUL character cannot be stored in text columns and is never legitimate input. */
export const NUL_MESSAGE = 'Text must not contain null characters';

/** JSON.parse reviver that refuses strings with a NUL character (body-parser reports it as a parse failure). */
export const rejectNulReviver = (_key: string, value: unknown): unknown => {
  if (typeof value === 'string' && value.includes('\u0000')) throw new SyntaxError(NUL_MESSAGE);
  return value;
};

/** Refuses a NUL character anywhere in the path or query string. */
export const rejectNulInUrl = (req: { url?: string }, res: Response, next: (e?: unknown) => void): void => {
  let decoded = req.url ?? '';
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // an undecodable address is handled by the router
  }
  if (decoded.includes('\u0000')) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: NUL_MESSAGE });
    return;
  }
  next();
};

/**
 * Express-level handler for everything that goes wrong before Nest routing: unreadable bodies (malformed JSON,
 * a junk gzip or an unsupported Content-Encoding, a body that is too large). Always the shared error format.
 */
export const bodyErrorHandler = (err: unknown, _req: unknown, res: Response, next: (e?: unknown) => void): void => {
  if (res.headersSent) return next(err);
  const e = err as { type?: string; status?: number; statusCode?: number; message?: string } | null;
  const status = e?.status ?? e?.statusCode;
  if (e?.type === 'entity.parse.failed') {
    const nul = typeof e.message === 'string' && e.message.includes(NUL_MESSAGE);
    res.status(400).json(nul ? { code: 'VALIDATION_ERROR', message: NUL_MESSAGE } : { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' });
  } else if (e?.type === 'entity.too.large' || status === 413) {
    res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });
  } else if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ code: 'VALIDATION_ERROR', message: status === 415 ? 'This content encoding is not supported' : 'The request body could not be read' });
  } else {
    res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong' });
  }
};
