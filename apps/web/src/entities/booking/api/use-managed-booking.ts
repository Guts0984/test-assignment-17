import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/shared/api';

export const managedBookingKey = (token: string) => ['managed-booking', token] as const;

export const useManagedBooking = (token: string) =>
  useQuery({ queryKey: managedBookingKey(token), queryFn: () => call(api.GET('/api/manage/{token}', { params: { path: { token } } })) });
