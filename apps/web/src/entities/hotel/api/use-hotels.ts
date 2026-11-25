import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/shared/api';

export const useHotels = () => useQuery({ queryKey: ['hotels'], queryFn: () => call(api.GET('/api/hotels')) });
