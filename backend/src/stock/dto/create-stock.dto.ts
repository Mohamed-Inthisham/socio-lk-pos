import { IsUUID, IsInt, Min, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStockDto {
  @ApiProperty({
    example: 'a3f2c8d0-1234-5678-9abc-def012345678',
    description: 'Product UUID',
    format: 'uuid',
  })
  @IsUUID()
  product_id!: string;

  @ApiProperty({
    example: 'b4e3d9e1-2345-6789-abcd-ef1234567890',
    description: 'Branch UUID',
    format: 'uuid',
  })
  @IsUUID()
  branch_id!: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Initial quantity. Defaults to 0.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Minimum quantity threshold. When quantity drops to this level, ' +
      'low_stock_alert becomes true in responses. Defaults to 0.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_quantity?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'Whether stock is actively tracked. Set to false for services or ' +
      'digital items where quantity does not matter. Defaults to true.',
  })
  @IsOptional()
  @IsBoolean()
  manage_stock?: boolean;
}
