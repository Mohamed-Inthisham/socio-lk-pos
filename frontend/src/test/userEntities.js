/**
 * Users page fixtures (Task 2.4), shaped like the backend's responses:
 * - userRow: one GET /users row, a SafeUser (users.service.ts toSafeUser)
 *   with its branch: never a password or PIN hash.
 * - usersPage: GET /users, { data, meta } from paginate().
 * - apiError: an axios error as Nest sends it: Bad/Forbidden/Conflict
 *   Exception({ message, code }) → that object; Exception(string) →
 *   { statusCode, message, error }.
 */

export const mainBranch = { id: "branch-main", name: "Main Shop", is_active: true };
export const kandyBranch = { id: "branch-kandy", name: "Kandy", is_active: true };

export const userRow = (overrides = {}) => ({
  id: "user-cashier",
  email: "nimal@socio.lk",
  full_name: "Nimal Silva",
  role: "cashier",
  is_active: true,
  branch_id: mainBranch.id,
  branch: mainBranch,
  approval_pin_set_at: null,
  phone: "0771234567",
  nic: "199012345678",
  address: "12 Temple Road, Kandy",
  created_at: "2026-10-01T04:00:00.000Z",
  updated_at: "2026-10-01T04:00:00.000Z",
  deleted_at: null,
  ...overrides,
});

export const adminRow = (overrides = {}) =>
  userRow({
    id: "user-admin",
    email: "ruwan@socio.lk",
    full_name: "Ruwan Fernando",
    role: "admin",
    branch_id: null,
    branch: null,
    approval_pin_set_at: "2026-10-20T04:00:00.000Z",
    ...overrides,
  });

export const managerRow = (overrides = {}) =>
  userRow({
    id: "user-manager",
    email: "asha@socio.lk",
    full_name: "Asha Perera",
    role: "manager",
    approval_pin_set_at: "2026-10-21T04:00:00.000Z",
    ...overrides,
  });

export const usersPage = (rows, { page = 1, totalPages = 1, total = rows.length } = {}) => ({
  data: rows,
  meta: { total, page, limit: 20, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
});

/** An axios error carrying the server's body (and, like axios, the request). */
export const apiError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
    config: { data: JSON.stringify({ new_password: "request-secret-pass" }) },
  });

export const codedError = (status, code, message = "server message") => apiError(status, { message, code });
