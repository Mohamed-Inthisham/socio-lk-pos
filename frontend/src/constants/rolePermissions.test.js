import { PERMISSIONS, ROLES, hasPermission } from "./rolePermissions";

describe("rolePermissions", () => {
  it.each([ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER])(
    "%s may apply line discounts at the till (Q11, P5-20)",
    (role) => {
      expect(hasPermission(role, PERMISSIONS.APPLY_DISCOUNT)).toBe(true);
    },
  );

  it.each([ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER])(
    "%s may start a void; a manager's PIN approves it (P6-8)",
    (role) => {
      expect(hasPermission(role, PERMISSIONS.VOID_SALE)).toBe(true);
    },
  );

  it.each([ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER])(
    "%s may start a return; a manager's PIN approves it (P7-19)",
    (role) => {
      expect(hasPermission(role, PERMISSIONS.REFUND_SALE)).toBe(true);
    },
  );

  it.each([
    [ROLES.ADMIN, true],
    [ROLES.MANAGER, true],
    [ROLES.CASHIER, false],
  ])("%s may pass a returned phone's check (Phones to check): %s (P7-7)", (role, allowed) => {
    expect(hasPermission(role, PERMISSIONS.PASS_INSPECTION)).toBe(allowed);
  });

  it.each([
    [ROLES.ADMIN, true],
    [ROLES.MANAGER, true],
    [ROLES.CASHIER, false],
  ])("%s may set their own approval PIN: %s (P6-18)", (role, allowed) => {
    expect(hasPermission(role, PERMISSIONS.SET_APPROVAL_PIN)).toBe(allowed);
  });
});
