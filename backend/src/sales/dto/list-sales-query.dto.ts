import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsUUID,
  IsEnum,
  IsISO8601,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SaleStatus } from '../enums/sale-status.enum';

/**
 * A timestamp with a time and an explicit offset (`Z` or `±HH:MM`). The
 * completed_at bounds take only this form: a date-only value would be read
 * as a UTC day, not a Colombo one (planning doc P6-2, FOLLOWUPS).
 */
const TIMESTAMP_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const TIMESTAMP_WITH_OFFSET_MESSAGE = (field: string) =>
  `${field} must be a timestamp with a time and an offset, e.g. ` +
  `2026-10-21T00:00:00+05:30 (encode "+" as %2B in a URL)`;

export const SALE_LIST_SORTS = ['created_at', 'completed_at'] as const;
export type SaleListSort = (typeof SALE_LIST_SORTS)[number];

/**
 * Query params for GET /sales.
 *
 * Extends PaginationQueryDto → gets page + limit for free.
 *
 * All filters optional and combined with AND. If none are provided,
 * returns the most recent page across all sales the caller can see. (In
 * R1 that's every sale since there's no branch scoping. Multi-branch list
 * scoping is a tracked followup for R9.)
 *
 * from/to are ISO date strings — YYYY-MM-DD or full timestamps both work.
 * The service converts them to inclusive-start / exclusive-end bounds:
 *   from=2026-08-01 → created_at >= '2026-08-01 00:00:00'
 *   to=2026-08-31   → created_at <  '2026-09-01 00:00:00'
 *
 * completedFrom/completedTo (Phase 6.4 P6-2) bound completed_at instead,
 * inclusive start and exclusive end, and need a time and an offset: the
 * POS sends one Colombo day as 00:00+05:30 → next day 00:00+05:30. A
 * DRAFT has no completed_at, so either bound leaves drafts out.
 *
 * q (P6-3) matches the sale number or the customer's name or phone
 * (case-insensitive substring), or an exact IMEI on a sale line or a
 * trade-in payment.
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

  @ApiPropertyOptional({
    example: '2026-10-21T00:00:00+05:30',
    description:
      'Inclusive start of the completed_at range. A timestamp with a time ' +
      'and an offset; date-only is a 400. Excludes DRAFT sales.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(TIMESTAMP_WITH_OFFSET, {
    message: TIMESTAMP_WITH_OFFSET_MESSAGE('completedFrom'),
  })
  completedFrom?: string;

  @ApiPropertyOptional({
    example: '2026-10-22T00:00:00+05:30',
    description:
      'Exclusive end of the completed_at range. A timestamp with a time ' +
      'and an offset; date-only is a 400. Excludes DRAFT sales.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(TIMESTAMP_WITH_OFFSET, {
    message: TIMESTAMP_WITH_OFFSET_MESSAGE('completedTo'),
  })
  completedTo?: string;

  @ApiPropertyOptional({
    description:
      'Sort order, newest first: created_at (default) or completed_at ' +
      '(ties broken by created_at).',
    enum: SALE_LIST_SORTS,
    default: 'created_at',
  })
  @IsOptional()
  @IsIn(SALE_LIST_SORTS)
  sort?: SaleListSort;

  @ApiPropertyOptional({
    description:
      'Search: sale number, customer name or customer phone ' +
      '(case-insensitive substring), or an exact IMEI on a sale line or a ' +
      'trade-in payment. Trimmed; empty is ignored; 2–100 characters ' +
      'after trimming.',
    example: '0042',
    minLength: 2,
    maxLength: 100,
  })
  @Transform(({ value }): unknown => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;
}
