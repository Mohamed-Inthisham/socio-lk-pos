import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Query params for GET /barcode-labels/products.
 *
 * Extends PaginationQueryDto: page and limit (default 1 / 50, max 200).
 *
 * search follows GET /products: trimmed first, empty or whitespace-only
 * means no search, and otherwise 2–100 characters (1 is a 400).
 */
export class SearchProductLabelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'charger',
    description:
      'Part of the product name, SKU or barcode, in any case. Trimmed; ' +
      'empty is ignored; 2–100 characters after trimming. % and _ match ' +
      'themselves.',
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
