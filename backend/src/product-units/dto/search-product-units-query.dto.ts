import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Query params for GET /product-units/search (INV-F3).
 *
 * Extends PaginationQueryDto (page, limit). There is deliberately no status
 * filter: a search covers every status, so a bought-back phone's earlier
 * records are found too, and an unknown param is a 400.
 *
 * Branch scoping is the list's: ProductUnitsController resolves branchId
 * with scopeBranch before the service runs.
 */
export class SearchProductUnitsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: '3569',
    description:
      'Part of an IMEI, serial number, SKU or product name, in any case. ' +
      'Trimmed; 2–100 characters after trimming. % and _ match themselves.',
    minLength: 2,
    maxLength: 100,
  })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({
    example: '11111111-1111-1111-1111-111111111111',
    description:
      'Search one branch. Admins: any, or every branch when left out. ' +
      'Managers: their own branch either way; another is 403 WRONG_BRANCH.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
