import { HttpException } from '@nestjs/common';
import { ERROR_STATUS, type DomainError, type Result } from '@hotel/shared';

export const toHttp = (e: DomainError): HttpException => new HttpException({ code: e.code, message: e.message, details: e.details }, ERROR_STATUS[e.code]);

/** Controllers turn expected failures (values) into HTTP errors at the edge. */
export const unwrap = <T>(r: Result<T, DomainError>): T => {
  if (!r.ok) throw toHttp(r.error);
  return r.value;
};
