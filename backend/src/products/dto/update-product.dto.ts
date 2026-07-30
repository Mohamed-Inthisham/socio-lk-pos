import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

/**
 * All fields from CreateProductDto are optional in update, PLUS `sku`
 * is allowed here (only in updates — never in creates).
 * See decision doc: SKU is always auto-generated on create, but admin
 * can rename it on update for corrections/migrations.
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional({
    example: 'SKU-000047',
    description:
      'SKU. Can only be changed on update, never provided on create. ' +
      'Must remain unique. Auto-generated SKUs continue from the counter — ' +
      'manual overrides do not reset the counter.',
    minLength: 1,
    maxLength: 30,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  sku?: string;
}
