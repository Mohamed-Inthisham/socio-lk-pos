import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource, ObjectLiteral } from 'typeorm';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import {
  AUDITABLE_KEY,
  AuditableMetadata,
} from '../decorators/auditable.decorator';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditLog } from '../entities/audit-log.entity';
import { diffObjects } from '../utils/diff-objects.util';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const metadata = this.reflector.get<AuditableMetadata>(
      AUDITABLE_KEY,
      context.getHandler(),
    );

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const entityId =
      typeof request.params.id === 'string' ? request.params.id : undefined;

    // Capture "before" state for UPDATE/DELETE (nothing exists yet for CREATE)
    let before: ObjectLiteral | null = null;
    if (metadata.action !== AuditAction.CREATE && entityId) {
      const repository = this.dataSource.getRepository(metadata.entityType);
      before = await repository.findOne({ where: { id: entityId } });
    }

    return next.handle().pipe(
      tap((result: ObjectLiteral) => {
        // Fire-and-forget: don't block the response on audit log writes
        void this.writeAuditLog(metadata, request, entityId, before, result);
      }),
    );
  }

  private async writeAuditLog(
    metadata: AuditableMetadata,
    request: Request,
    entityId: string | undefined,
    before: ObjectLiteral | null,
    result: ObjectLiteral,
  ): Promise<void> {
    try {
      const user = request.user;

      const changes =
        metadata.action === AuditAction.UPDATE
          ? diffObjects(before, result)
          : null;

      const auditLogRepository = this.dataSource.getRepository(AuditLog);

      await auditLogRepository.save({
        user_id: user?.id ?? null,
        user_name: user?.full_name ?? 'Unknown',
        user_role: user?.role ?? 'unknown',
        action: metadata.action,
        entity_type: metadata.entityType,
        entity_id: entityId ?? (result?.id as string) ?? 'unknown',
        changes,
        ip_address: request.ip ?? null,
      });
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }
  }
}
