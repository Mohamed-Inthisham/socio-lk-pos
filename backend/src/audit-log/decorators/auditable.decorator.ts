import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '../enums/audit-action.enum';

export const AUDITABLE_KEY = 'auditable';

export interface AuditableMetadata {
  entityType: string;
  action: AuditAction;
}

export const Auditable = (entityType: string, action: AuditAction) =>
  SetMetadata(AUDITABLE_KEY, { entityType, action });
