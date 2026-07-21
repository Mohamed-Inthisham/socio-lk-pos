import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

export interface PaginatedAuditLogs {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async findAll(query: QueryAuditLogsDto): Promise<PaginatedAuditLogs> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.auditLogRepository.createQueryBuilder('log');

    if (query.user_id) {
      qb.andWhere('log.user_id = :user_id', { user_id: query.user_id });
    }

    if (query.entity_type) {
      qb.andWhere('log.entity_type = :entity_type', {
        entity_type: query.entity_type,
      });
    }

    if (query.entity_id) {
      qb.andWhere('log.entity_id = :entity_id', {
        entity_id: query.entity_id,
      });
    }

    if (query.action) {
      qb.andWhere('log.action = :action', { action: query.action });
    }

    if (query.from) {
      qb.andWhere('log.created_at >= :from', { from: query.from });
    }

    if (query.to) {
      qb.andWhere('log.created_at <= :to', { to: query.to });
    }

    qb.orderBy('log.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }
}
