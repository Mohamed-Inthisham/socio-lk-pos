export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  DEACTIVATE = 'DEACTIVATE',
  REACTIVATE = 'REACTIVATE',
  COMPLETE = 'COMPLETE',
  VOID = 'VOID',
  // Manager approval PIN (Phase 6.4 P6-18, P6-19). Never carry the PIN,
  // its hash or a password: only who, whose PIN, and what happened.
  APPROVAL_PIN_SET = 'APPROVAL_PIN_SET',
  APPROVAL_PIN_SET_REJECTED = 'APPROVAL_PIN_SET_REJECTED',
  APPROVAL_PIN_CLEARED = 'APPROVAL_PIN_CLEARED',
  APPROVAL_PIN_FAILED = 'APPROVAL_PIN_FAILED',
  APPROVAL_PIN_LOCKED = 'APPROVAL_PIN_LOCKED',
  // A returned phone checked and put back on sale (Phase 6.4 P7-7).
  INSPECTION_PASSED = 'INSPECTION_PASSED',
  // A return on a completed sale, approved with a manager's PIN (P7-14).
  RETURN = 'RETURN',
  // The day's opening and closing balance (Phase 6.4 P9-19).
  DAY_OPEN = 'DAY_OPEN',
  DAY_CLOSE = 'DAY_CLOSE',
  // An unpaid draft sale discarded by its branch's day close: one row per
  // draft, with its lines (no cost prices).
  DRAFT_DISCARDED = 'DRAFT_DISCARDED',
  // A user's role and/or branch changed by an admin (Task 2.2): old and new
  // role and branch only.
  ROLE_CHANGED = 'ROLE_CHANGED',
  // A password set by an admin for another user, or changed by its owner
  // (Task 2.3). Who and whose only: never a password or a hash.
  PASSWORD_RESET = 'PASSWORD_RESET',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
}
