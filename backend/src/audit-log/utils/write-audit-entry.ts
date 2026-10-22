import { EntityManager } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditAction } from '../enums/audit-action.enum';

/** Who did it: the session user (AuthenticatedUser has these fields). */
export interface AuditActor {
  id: string;
  full_name: string;
  role: string;
}

export interface AuditEntry {
  actor: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId: string;
  description: string;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  ip?: string | null;
}

/**
 * Write one audit row inside the caller's transaction, so it commits (or
 * rolls back) with the change it describes. Used where the
 * AuditLogInterceptor can't help: it records only successful responses,
 * and has no changes for anything but UPDATE (Phase 6.4 P6-17 – P6-19).
 *
 * Callers pass only what may be stored: never a PIN, a hash or a
 * password. Nothing here reads the request body.
 */
export async function writeAuditEntry(
  manager: EntityManager,
  entry: AuditEntry,
): Promise<void> {
  await manager.getRepository(AuditLog).save({
    user_id: entry.actor.id,
    user_name: entry.actor.full_name,
    user_role: entry.actor.role,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    changes: entry.changes ?? null,
    description: entry.description,
    ip_address: entry.ip ?? null,
  });
}
