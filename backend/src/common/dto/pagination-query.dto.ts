import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Reusable pagination query params for any list endpoint.
 *
 * Defaults: page=1, limit=50. Max limit=200 to prevent someone
 * requesting ?limit=1000000 and DoSing the API.
 *
 * Extend this DTO in module-specific list DTOs to add filters:
 *
 *   export class ListSalesQueryDto extends PaginationQueryDto {
 *     @IsOptional() @IsUUID() branchId?: string;
 *   }
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '1-based page number. Default: 1',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 50,
    description: 'Rows per page. Default: 50. Max: 200',
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
