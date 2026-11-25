import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

const isApiError = (e: unknown): e is ApiError => typeof e === 'object' && e !== null && 'code' in e && 'message' in e;

export const toApiError = (e: unknown): ApiError => (isApiError(e) ? e : { code: 'INTERNAL', message: 'Something went wrong, please try again' });

/** Server validation issues are shown next to the fields they belong to. Returns true if any was placed. */
export const applyFieldErrors = <T extends FieldValues>(e: ApiError, setError: UseFormSetError<T>): boolean => {
  const issues = (e.details as { issues?: { path: string; message: string }[] } | undefined)?.issues;
  if (!issues || issues.length === 0) return false;
  for (const i of issues) setError(i.path as Path<T>, { type: 'server', message: i.message });
  return true;
};
