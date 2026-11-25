import type { Role } from '@hotel/shared';

export interface StaffRoleGrant {
  readonly hotelId: string | null;
  readonly role: Role;
}

export interface StaffIdentity {
  readonly id: string;
  readonly name: string;
  readonly roles: readonly StaffRoleGrant[];
}

/** A role bound to `null` hotel is chain-wide (admin). */
export const hasRole = (staff: StaffIdentity, hotelId: string, allowed: readonly Role[]): boolean =>
  staff.roles.some((g) => allowed.includes(g.role) && (g.hotelId === null || g.hotelId === hotelId));

export const hasAnyRole = (staff: StaffIdentity, allowed: readonly Role[]): boolean => staff.roles.some((g) => allowed.includes(g.role));

export const hotelsFor = (staff: StaffIdentity, allowed: readonly Role[]): readonly (string | null)[] =>
  staff.roles.filter((g) => allowed.includes(g.role)).map((g) => g.hotelId);
