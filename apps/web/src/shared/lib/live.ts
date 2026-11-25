import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { readToken } from './session';

/**
 * Live updates over Socket.IO. The server checks the token and the staff member's role in the hotel
 * before it lets the socket join the hotel's room. `onEvent` fires for any of the named events.
 */
export const useLiveEvents = (hotelId: string, events: readonly string[], onEvent: () => void): void => {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const key = events.join(',');
  useEffect(() => {
    if (!hotelId) return;
    const socket = io({ path: '/socket.io', auth: { token: readToken() }, transports: ['websocket', 'polling'] });
    // on every (re)connect: join again and refetch, because events sent while offline are gone
    socket.on('connect', () => {
      socket.emit('join', { hotelId });
      handler.current();
    });
    for (const name of key.split(',')) socket.on(name, () => handler.current());
    return () => {
      socket.disconnect();
    };
  }, [hotelId, key]);
};
