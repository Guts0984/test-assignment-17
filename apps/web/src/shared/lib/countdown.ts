import { useEffect, useState } from 'react';

/** Seconds left until `expiresAt`, counted on the SERVER's clock (offset taken once from `serverNow`). */
export const useServerCountdown = (expiresAt: string | null, serverNow: string | undefined): number | null => {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt || !serverNow) return;
    const offset = Date.parse(serverNow) - Date.now();
    const tick = (): void => setLeft(Math.max(0, Math.ceil((Date.parse(expiresAt) - (Date.now() + offset)) / 1000)));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [expiresAt, serverNow]);
  return left;
};
