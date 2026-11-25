import { useState } from 'react';
import { toApiError } from './errors';

interface FetchResult<T> {
  readonly data?: T;
  readonly error?: unknown;
}

/** Runs one API call: tracks busy state and keeps the API's error message for display. */
export const useAction = () => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async <T>(call: () => Promise<FetchResult<T>>, onOk?: (data: T) => void | Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      if (r.error !== undefined || r.data === undefined) {
        setError(toApiError(r.error).message);
        return false;
      }
      await onOk?.(r.data);
      return true;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, clear: () => setError(null) };
};
