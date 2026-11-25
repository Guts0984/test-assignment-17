import { useHotels } from '../api/use-hotels';
import { rolesOf, useSession } from '@/shared/lib';

/** Hotels the signed-in staff member may work in with one of `roles` (chain-wide grants see all hotels). */
export const useStaffHotels = (roles: readonly string[]) => {
  const session = useSession();
  const hotels = useHotels();
  const grants = session?.staff.roles.filter((g) => roles.includes(g.role)) ?? [];
  const chainWide = grants.some((g) => g.hotelId === null);
  const list = (hotels.data ?? []).filter((h) => chainWide || grants.some((g) => g.hotelId === h.id));
  return { session, hotels: list, roles: rolesOf(session), loading: hotels.isLoading };
};
