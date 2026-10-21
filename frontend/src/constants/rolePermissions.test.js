import { PERMISSIONS, ROLES, hasPermission } from "./rolePermissions";

describe("rolePermissions", () => {
  it.each([ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER])(
    "%s may apply line discounts at the till (Q11, P5-20)",
    (role) => {
      expect(hasPermission(role, PERMISSIONS.APPLY_DISCOUNT)).toBe(true);
    },
  );
});
