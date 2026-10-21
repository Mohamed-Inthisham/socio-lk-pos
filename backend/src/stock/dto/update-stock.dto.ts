import { IsInt, Min, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptionalNotNull } from '../../common/validators/is-optional-not-null.decorator';

/**
 * Stock updates in R1. Deliberately excludes product_id and branch_id —
 * those never change after creation. Admin only adjusts quantity,
 * min_quantity, or the manage_stock flag.
 */
export class UpdateStockDto {
  @ApiPropertyOptional({
    example: 25,
    description: 'New absolute quantity. Set this when receiving new stock.',
    minimum: 0,
  })
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'New low-stock alert threshold.',
    minimum: 0,
  })
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  min_quantity?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Enable or disable stock tracking for this product+branch.',
  })
  @IsOptionalNotNull()
  @IsBoolean()
  manage_stock?: boolean;
}
