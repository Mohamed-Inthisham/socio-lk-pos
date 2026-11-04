import { Expose } from 'class-transformer';
import { UserRole } from '../../users/enums/user-role.enum';

/**
 * Buying and cost prices (INV-F3): admins and managers see them, cashiers
 * never do, whatever endpoint or relation carries them.
 *
 * Fields marked @ExposeCost() are left out of every response unless the
 * serializer adds COST_GROUP (RoleAwareSerializerInterceptor), so a new
 * endpoint or a request without a user stays hidden. This only applies to
 * entities: a plain object built from raw SQL must check canViewCost itself,
 * as GET /sales/daily-summary does. Nothing changes inside the backend:
 * services still read these fields.
 *
 * A trade-in's value (Payment.trade_in_buying_price) is deliberately not
 * covered: it equals the payment's amount, a tender the cashier enters and
 * the sale's totals need.
 */
export const COST_GROUP = 'cost';

/** Mark an entity field as a buying or cost price. */
export const ExposeCost = (): PropertyDecorator =>
  Expose({ groups: [COST_GROUP], toPlainOnly: true });

const COST_ROLES: readonly UserRole[] = [UserRole.ADMIN, UserRole.MANAGER];

/** May this session user see buying and cost prices? */
export function canViewCost(actor?: { role: UserRole } | null): boolean {
  return !!actor && COST_ROLES.includes(actor.role);
}
