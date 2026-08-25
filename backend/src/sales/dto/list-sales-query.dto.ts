import { IsOptional, IsUUID, IsEnum, IsISO8601 } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SaleStatus } from '../enums/sale-status.enum';

/**
 * Query params for GET /sales.
 *
 * Extends PaginationQueryDto → gets page + limit for free.
 *
 * All filters optional. If none are provided, returns the most recent
 * page across all sales the caller can see. (In R1 that's every sale
 * since there's no branch scoping. Multi-branch list scoping is a
 * tracked followup for R9.)
 *
 * from/to are ISO date strings — YYYY-MM-DD or full timestamps both work.
 * The service converts them to inclusive-start / exclusive-end bounds:
 *   from=2026-08-01 → created_at >= '2026-08-01 00:00:00'
 *   to=2026-08-31   → created_at <  '2026-09-01 00:00:00'
 */
export class ListSalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter to sales at this branch',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Filter to sales by this cashier',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  cashierId?: string;

  @ApiPropertyOptional({
    description: 'Filter to sales in this lifecycle state',
    enum: SaleStatus,
  })
  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;

  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Inclusive start of created_at range (ISO date or timestamp)',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description:
      'End of created_at range. If a date-only string is passed, the ' +
      'service treats it as end-of-day (exclusive) — passing 2026-08-31 ' +
      'returns sales up to and including 2026-08-31 23:59:59.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
