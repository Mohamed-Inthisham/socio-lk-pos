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
 * Branch scoping (Phase 2 P2-2): admins see every branch, or the one in
 * branchId; managers and cashiers see only their own branch, and a
 * branchId for another branch is 403 WRONG_BRANCH.
 * PhonePurchasesController resolves branchId before the service runs.
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
