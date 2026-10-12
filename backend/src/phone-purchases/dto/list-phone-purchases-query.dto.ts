import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Query params for GET /phone-purchases.
 *
 * Extends PaginationQueryDto (page, limit). All filters are optional
 * and combine with AND semantics — passing customer_id AND branchId
 * returns purchases matching both.
 *
 * Multi-branch list scoping ("only my branch") is deferred to R9,
 * matching the Sales precedent. Cashiers currently see all purchases;
 * frontend can pass branchId explicitly when the UX wants scoping.
 */
export class ListPhonePurchasesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '22222222-2222-2222-2222-222222222222',
    description:
      'Filter to purchases from a specific customer. Useful for ' +
      'rendering a customer purchase history without needing a ' +
      'separate sub-resource endpoint.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @ApiPropertyOptional({
    example: '11111111-1111-1111-1111-111111111111',
    description:
      'Filter to purchases at a specific branch. Camel-cased to ' +
      'match the ListSalesQueryDto naming convention (branchId, ' +
      'not branch_id) for query params.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
