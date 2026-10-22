/**
 * Auth and approval-PIN fixtures, copied from the backend (P6 step D1).
 *
 * - backendMeUser: GET /auth/me's `user` and login's `user`, the
 *   AuthenticatedUser built in backend/src/auth/strategies/jwt.strategy.ts
 *   validate() (login mirrors it, auth.controller.ts).
 * - toSessionUser: what authService's mapBackendUser keeps in Redux.
 * - PUT /auth/me/approval-pin bodies, from approvals.service.ts setOwnPin
 *   and the global ValidationPipe, exactly as Nest sends them:
 *   ForbiddenException({ message, code }) → that object; Bad/Forbidden
 *   Exception(string) → { statusCode, message, error }.
 */

// With the extension: the layout harness imports these fixtures in plain Node too.
import { branchEntity } from "./saleEntities.js";

/** backend/src/auth/strategies/jwt.strategy.ts AuthenticatedUser */
export const backendMeUser = (overrides = {}) => ({
  id: "user-manager",
  email: "asha@socio.lk",
  full_name: "Asha Perera",
  role: "manager",
  branch_id: "branch-main",
  branch: branchEntity(),
  has_approval_pin: false,
  approval_pin_set_at: null,
  ...overrides,
});

/** Same mapping as frontend/src/services/authService.js mapBackendUser. */
export const toSessionUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.full_name,
  role: u.role,
  branch_id: u.branch_id ?? null,
  branch: u.branch ?? null,
  has_approval_pin: u.has_approval_pin ?? false,
  approval_pin_set_at: u.approval_pin_set_at ?? null,
  avatar: null,
});

export const managerSessionUser = (overrides = {}) => toSessionUser(backendMeUser(overrides));

export const adminSessionUser = (overrides = {}) =>
  toSessionUser(
    backendMeUser({ id: "user-admin", email: "admin@socio.lk", full_name: "Ruwan Fernando", role: "admin", branch_id: null, branch: null, ...overrides }),
  );

export const cashierSessionUser = (overrides = {}) =>
  toSessionUser(backendMeUser({ id: "user-cashier", email: "nimal@socio.lk", full_name: "Nimal Silva", role: "cashier", ...overrides }));

/** 200 from PUT /auth/me/approval-pin */
export const pinSetResponse = (approval_pin_set_at = "2026-10-22T09:05:00.000Z") => ({
  has_approval_pin: true,
  approval_pin_set_at,
});

const axiosError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
    // As axios does: the request body is on the error. It holds the
    // password and the PIN, which is why nothing may log or store the error.
    config: { data: JSON.stringify({ current_password: "secret-pass", pin: "482915" }) },
  });

/** 403, wrong current password (audited). */
export const wrongPasswordError = () =>
  axiosError(403, { message: "Current password is incorrect.", code: "WRONG_PASSWORD" });

/** 400, the weak-PIN rule on the server. */
export const weakPinError = () =>
  axiosError(400, {
    statusCode: 400,
    message: "That PIN is too easy to guess: avoid one repeated digit and straight runs like 123456 or 654321.",
    error: "Bad Request",
  });

/** 400 from the ValidationPipe (SetApprovalPinDto). */
export const malformedPinError = () =>
  axiosError(400, { statusCode: 400, message: ["pin must be exactly 6 digits"], error: "Bad Request" });

/** 403 for a cashier (ForbiddenException with a string: no code). */
export const notManagerError = () =>
  axiosError(403, { statusCode: 403, message: "Only managers and admins can set an approval PIN.", error: "Forbidden" });

/** No response (network down). */
export const networkError = () =>
  Object.assign(new Error("Network Error"), {
    code: "ERR_NETWORK",
    config: { data: JSON.stringify({ current_password: "secret-pass", pin: "482915" }) },
  });
