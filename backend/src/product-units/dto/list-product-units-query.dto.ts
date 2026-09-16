import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ProductUnitStatus } from '../enums/product-unit-status.enum';

/**
 * Normalize an optional string field: trim whitespace, convert empty
 * strings to null. Same pattern as CreateSaleDto.
 */
const trimStringField = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Query params for GET /product-units.
 *
 * Extends PaginationQueryDto (page, limit). All filters are optional
 * and combine with AND semantics.
 *
 * Endpoint is ADMIN/MANAGER only per Q6 decision — cashiers interact
 * with ProductUnits implicitly via IMEI at ring-up (Slice E), not
 * through browse endpoints. Multi-branch list scoping deferred to R9
 * matching Sales precedent.
 */
export class ListProductUnitsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '33333333-3333-3333-3333-333333333333',
    description:
      'Filter to units of a specific product. Useful for "how many ' +
      'of this SKU do we have across statuses" reporting.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    example: '11111111-1111-1111-1111-111111111111',
    description:
      'Filter to units at a specific branch. Camel-cased to match ' +
      'ListSalesQueryDto naming convention (see followup on ' +
      'query-param casing consistency).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    enum: ProductUnitStatus,
    example: ProductUnitStatus.IN_STOCK,
    description:
      'Filter by current unit status. Values: IN_STOCK (available ' +
      'to sell), SOLD (already sold), RETURNED (customer returned, ' +
      'processing), WRITTEN_OFF (damaged/lost/removed).',
  })
  @IsOptional()
  @IsEnum(ProductUnitStatus)
  status?: ProductUnitStatus;

  @ApiPropertyOptional({
    example: '356938035643809',
    description:
      'Filter to a specific IMEI. Exact-match lookup — for a ' +
      'partial-match search, wait for a future search endpoint. ' +
      'Trimmed on input; empty string normalizes to no filter.',
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  imei?: string;
}
