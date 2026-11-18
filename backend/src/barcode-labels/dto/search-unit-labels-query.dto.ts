import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Query params for GET /barcode-labels/units.
 *
 * Extends PaginationQueryDto: page and limit (default 1 / 50, max 200).
 *
 * search follows GET /barcode-labels/products: trimmed first, empty or
 * whitespace-only means no search, and otherwise 2–100 characters.
 *
 * Branch scoping is the product-units reads': BarcodeLabelsController
 * resolves branchId with scopeBranch before the service runs.
 */
export class SearchUnitLabelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '3569',
    description:
      'Part of the IMEI, serial number, unit code, or the product’s SKU or ' +
      'name, in any case. Trimmed; empty is ignored; 2–100 characters after ' +
      'trimming. % and _ match themselves.',
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
    example: '11111111-1111-1111-1111-111111111111',
    description:
      'Units at one branch. Admins: any, or every branch when left out. ' +
      'Managers: their own branch either way; another is 403 WRONG_BRANCH.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    example: '33333333-3333-3333-3333-333333333333',
    description: 'Units of one product',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;
}
