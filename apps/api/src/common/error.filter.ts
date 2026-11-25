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

/** Express-level handler for failures before Nest routing (malformed JSON, body too large). */
export const bodyErrorHandler = (err: unknown, _req: unknown, res: Response, next: (e?: unknown) => void): void => {
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' });
  } else if (type === 'entity.too.large') {
    res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });
  } else {
    next(err);
  }
};
