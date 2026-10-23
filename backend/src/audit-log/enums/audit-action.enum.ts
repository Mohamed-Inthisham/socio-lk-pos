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
}
