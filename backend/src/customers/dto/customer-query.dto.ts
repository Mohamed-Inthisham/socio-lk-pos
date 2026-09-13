import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Query params for GET /customers.
 *
 * Extends PaginationQueryDto (codebase convention) → inherits page/limit.
 *
 * Filters:
 * - search: substring match across name / phone / nic (server-side ILIKE).
 * - include_deleted: default false. When "true", returns soft-deleted rows
 *   as well. Used by admin views for restore workflows.
 *
 * Kept minimal on purpose. If we later need branch-scoped views or
 * date-range filters, extend this DTO — don't route new params through
 * the URL path.
 */
export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Substring match across name, phone, and NIC (case-insensitive).',
    example: 'kamal',
    maxLength: 100,
  })
  @Transform(({ value }): unknown => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Include soft-deleted customers. Defaults to false.',
    example: 'false',
  })
  @IsOptional()
  @IsBooleanString()
  include_deleted?: string;
}
