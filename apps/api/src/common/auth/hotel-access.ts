import { HttpException } from '@nestjs/common';
import { domainError, ERROR_STATUS, type Role } from '@hotel/shared';
import { hasRole, type StaffIdentity } from './access';

/** Per-resource check: the staff member needs one of these roles in THIS hotel. */
export const requireHotel = (staff: StaffIdentity, hotelId: string, roles: readonly Role[]): void => {
  if (!hasRole(staff, hotelId, roles)) {
    throw new HttpException(domainError('FORBIDDEN', 'You have no access to this hotel'), ERROR_STATUS.FORBIDDEN);
  }
};

/** Foreign hotels look like missing resources: do not reveal that they exist. */
export const hideForeignHotel = (staff: StaffIdentity, hotelId: string, roles: readonly Role[]): void => {
  if (!hasRole(staff, hotelId, roles)) {
    throw new HttpException(domainError('NOT_FOUND', 'Not found'), ERROR_STATUS.NOT_FOUND);
  }
};
