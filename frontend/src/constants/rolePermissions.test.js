import { PERMISSIONS, ROLES, hasPermission } from "./rolePermissions";

describe("rolePermissions", () => {
  it.each([ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER])(
    "%s may apply line discounts at the till (Q11, P5-20)",
    (role) => {
      expect(hasPermission(role, PERMISSIONS.APPLY_DISCOUNT)).toBe(true);
    },
  );

  it.each([
    [ROLES.ADMIN, true],
    [ROLES.MANAGER, true],
    [ROLES.CASHIER, false],
  ])("%s may set their own approval PIN: %s (P6-18)", (role, allowed) => {
    expect(hasPermission(role, PERMISSIONS.SET_APPROVAL_PIN)).toBe(allowed);
  });
});
