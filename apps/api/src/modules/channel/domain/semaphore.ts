/** Caps in-process concurrency so that waiting transactions can never exhaust the db pool. */
export const createSemaphore = (max: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active < max) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      release();
    }
  };
};
