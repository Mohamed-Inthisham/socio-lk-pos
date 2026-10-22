# Manager Approval PIN

A manager or admin approves an action at the till by choosing their name and entering a 6-digit PIN. Every sale void needs one (Phase 6.4 P6-17); returns will use the same check (P7). Planning doc: [phase-6.4-pos-terminal.md](../frontend/phase-6.4-pos-terminal.md) §8 P6-15 – P6-21. Code: `backend/src/approvals/`.

## Storage

Four columns on `users` (migration `AddApprovalPinAndVoidRequestedBy`):

| Column | Type | Notes |
|---|---|---|
| `approval_pin_hash` | varchar(255) NULL | bcrypt with `BCRYPT_ROUNDS`, the password's cost. `select: false` and `@Exclude`, exactly like `password_hash`: loaded only by an explicit `addSelect` (or raw SQL in the PIN check), never serialized |
| `approval_pin_set_at` | timestamptz NULL | When it was set. Not secret: `/auth/me` and login show it, with `has_approval_pin` |
| `approval_pin_failed_attempts` | smallint NOT NULL DEFAULT 0 | Wrong PINs in a row. `@Exclude`: in no user response |
| `approval_pin_locked_until` | timestamptz NULL | The lock. `@Exclude`: in no user response |

CHECKs: `CHK_users_approval_pin_role` (only admins and managers hold a PIN), `CHK_users_approval_pin_set_at` (set time present exactly when the hash is), `CHK_users_approval_pin_attempts` (count ≥ 0).

`has_approval_pin` and `approval_pin_set_at` come from the database on every request (`JwtStrategy.validate` reloads the user), never from the JWT, so they are right straight after a PIN is set or cleared.

## The PIN

Exactly 6 digits. **Weak-PIN rule** (`weak-pin.ts`): with digits d1…d6, a PIN is refused when every step d(i+1) − d(i), i = 1…5, is the same value and that value is 0, +1 or −1. That is exactly 20 PINs: `000000`…`999999`, `012345`…`456789`, `543210`…`987654`. No wrap-around (`890123` is fine).

## The check: `ApprovalsService.verify`

`verify({ approverId, pin, action, branchId, requestedBy, ip })` returns `{ id, full_name, role }` or throws. `action` names what is approved (`SALE_VOID`; P7 adds its own) and goes into the audit rows.

**Its own committed transaction.** `verify` opens `dataSource.transaction(...)` itself; it never joins the caller's. Inside, it writes the count, the lock and their audit rows and **returns** the outcome; it throws only after the commit. So a refused or rolled-back action can never undo a failed attempt or a lock, and a correct PIN's reset sticks even if the action then fails (both proven in e2e).

**Row lock.** The approver's row is read with `SELECT … FOR UPDATE`, so guesses sent at the same moment queue; each sees the count the previous one left (e2e: three parallel wrong guesses at count 3 end at 5 and locked, never at 4).

**Database clock on both sides.** The same locked SELECT computes `approval_pin_locked_until > now() AS locked` and `approval_pin_locked_until <= now() AS lock_expired`; the lock is set with `approval_pin_locked_until = now() + '15 minutes'::interval`. No JavaScript `Date` decides anything.

Order, and the refusals (always `{ message, code }`, never the PIN; never 401, which the frontend would answer with a token refresh):

| # | Condition | Status | `code` | `message` |
|---|---|---|---|---|
| 1 | Unknown or soft-deleted approver | 403 | `APPROVER_NOT_FOUND` | Approval failed: approver not found. |
| 2 | Inactive | 403 | `APPROVER_INACTIVE` | `<name>` can't approve: their account is inactive. |
| 3 | Not an admin or manager | 403 | `APPROVER_NOT_MANAGER` | `<name>` can't approve: only managers and admins can. |
| 4 | A manager of another branch (admins approve anywhere) | 403 | `APPROVER_WRONG_BRANCH` | `<name>` can only approve for their own branch. |
| 5 | No PIN set | 403 | `APPROVER_NO_PIN` | `<name>` has no approval PIN set. |
| 6 | Locked | 423 | `PIN_LOCKED` + `locked_until` | `<name>`'s PIN is locked until HH:MM. — **the PIN is not compared** |
| 7 | Lock expired | — | — | The count starts again from 0 |
| 8 | Wrong PIN, attempts 1–4 | 403 | `WRONG_PIN` + `attempts_left` | Wrong PIN. N attempts left. |
| 9 | Wrong PIN, 5th in a row | 423 | `PIN_LOCKED` + `locked_until` | Wrong PIN. `<name>`'s PIN is locked until HH:MM. — locked 15 minutes |
| 10 | Correct PIN | — | — | Count reset to 0, lock cleared; returns the approver |

The approver may be the session user (a manager approving their own void). A locked-out manager can't approve anything, their own voids included, until the lock expires, another manager or admin approves, or an admin clears their PIN. A lock blocks PIN approvals only, not the login.

## Endpoints

| Method | Path | Role | Request → response |
|---|---|---|---|
| GET | `/approvers?branchId=` | any; non-admins only their own branch (403 otherwise) | → 200 `[{ id, full_name }]`: active admins, and active managers of that branch, with a PIN set, by name. Nothing else |
| PUT | `/auth/me/approval-pin` | admin, manager | `{ current_password, pin }` → 200 `{ has_approval_pin: true, approval_pin_set_at }`. Resets count and lock. 400 malformed or weak PIN; 403 `WRONG_PASSWORD` (audited) or a cashier |
| DELETE | `/users/:id/approval-pin` | admin | → 204, also when none was set. Clears hash, set time, count and lock. 404 unknown user |
| POST | `/sales/:id/void` | any, at the sale's branch | `approval: { approver_id, pin }` required; see [sales.md](./sales.md) "Every void is approved with a manager's PIN" |

Nobody can set another user's PIN: an admin clears it and the user sets a new one (a new manager sets theirs after first login).

## Audit

Written by the service inside the transaction they describe (the `AuditLogInterceptor` records only successful responses, has no changes for these actions, and never reads request bodies):

| Action | Actor | Target (`entity_id`) |
|---|---|---|
| `APPROVAL_PIN_SET` | the user | themselves |
| `APPROVAL_PIN_SET_REJECTED` | the user (wrong current password) | themselves |
| `APPROVAL_PIN_CLEARED` | the admin | the user whose PIN was cleared |
| `APPROVAL_PIN_FAILED` | the session user | the approver |
| `APPROVAL_PIN_LOCKED` | the session user | the approver |
| `VOID` (Sale) | the session user | the sale; `changes` carry `voided_by` (approver) and `void_requested_by` |

No audit row, log line, error body or validation message carries the PIN, its hash or a password (e2e: audit rows, error bodies and console output are checked).

## Lifecycle

- `UsersService.deactivate()` clears the PIN, its count and its lock.
- Roles can't change today (`UpdateUserDto` has no `role`). `CHK_users_approval_pin_role` makes a cashier holding a PIN impossible: a future route that demotes a user to cashier, or deactivates one, must clear the PIN fields first (FOLLOWUPS).
