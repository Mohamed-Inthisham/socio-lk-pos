import { TrackingMethod } from '../enums/tracking-method.enum';
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
import { ProductType } from '../enums/product-type.enum';

/**
 * Query params for GET /products.
 *
 * Extends PaginationQueryDto (codebase convention) → inherits page/limit
 * (default 1 / 50, max limit 200).
 *
 * Filters (all optional, combined with AND):
 * - search: case-insensitive substring match on name (server-side ILIKE).
 *   Trimmed first; empty/whitespace-only is treated as absent. After
 *   trimming it must be 2–100 chars — 1 char is rejected with 400, the
 *   same way every other list DTO rejects out-of-range input.
 * - includeInactive: "true" | "false". Anything else is a 400 (matches
 *   the ParseBoolPipe behaviour this endpoint had before the DTO).
 * - brandId / categoryId / branchId: UUIDs.
 * - trackingMethod: QUANTITY | IMEI | SERIAL_NUMBER.
 */
export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive substring match on product name. Trimmed; ' +
      'empty is ignored; 2–100 characters after trimming.',
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

  @ApiPropertyOptional({
    description: 'Include deactivated products (admin UI toggle)',
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

  @ApiPropertyOptional({ description: 'Filter by brand', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Filter by category', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Filter by owning branch',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    enum: TrackingMethod,
    description: 'Filter by tracking method',
  })
  @IsOptional()
  @IsEnum(TrackingMethod)
  trackingMethod?: TrackingMethod;

  @ApiPropertyOptional({
    deprecated: true,
    description: 'Filter by legacy product type',
    enum: ProductType,
  })
  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;
}
