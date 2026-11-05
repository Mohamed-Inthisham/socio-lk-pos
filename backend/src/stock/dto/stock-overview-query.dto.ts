import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StockStatus } from '../enums/stock-status.enum';

/**
 * Query params for GET /stock/overview (INV-F4).
 *
 * Extends PaginationQueryDto (page, limit). All filters are optional and
 * combine with AND.
 *
 * Branch scoping: StockController resolves branchId with scopeBranch before
 * the service runs.
 */
export class StockOverviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '11111111-1111-1111-1111-111111111111',
    description:
      'One branch. Admins: any branch, inactive ones included, or every ' +
      'branch when left out. Managers: their own branch either way; another ' +
      'is 403 WRONG_BRANCH.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Include deactivated products alongside active products',
    type: Boolean,
    example: false,
  })
  @Transform(({ value }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({
    enum: StockStatus,
    description:
      'Only products with this status. Filters data and meta; summary ' +
      'still counts every status.',
  })
  @IsOptional()
  @IsEnum(StockStatus)
  stockStatus?: StockStatus;

  @ApiPropertyOptional({
    description:
      'Part of a product name, SKU or barcode, in any case. Trimmed; empty ' +
      'is ignored; 2–100 characters after trimming. % and _ match themselves.',
    example: 'iphone',
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
  search?: string;
}
