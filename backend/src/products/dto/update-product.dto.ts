import { OmitType, PartialType } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';
import { WarrantyPeriod } from '../enums/warranty-period.enum';

/**
 * All fields from CreateProductDto are optional in update, PLUS `sku`
 * is allowed here (only in updates — never in creates).
 * See decision doc: SKU is always auto-generated on create, but admin
 * can rename it on update for corrections/migrations.
 *
 * default_warranty is re-declared rather than inherited: PartialType adds
 * @IsOptional to every field, which lets null skip validation and reach
 * the NOT NULL column (a 500). Here null is a 400 (P5-18).
 */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['default_warranty'] as const),
) {
  @ApiPropertyOptional({
    enum: WarrantyPeriod,
    example: WarrantyPeriod.MONTH_12,
    description:
      'The warranty a sale line of this product starts with (P5-18). ' +
      'Omit to leave it unchanged; null is rejected.',
  })
  @ValidateIf((o: UpdateProductDto) => o.default_warranty !== undefined)
  @IsEnum(WarrantyPeriod, {
    message: `default_warranty must be one of: ${Object.values(WarrantyPeriod).join(', ')}`,
  })
  default_warranty?: WarrantyPeriod;

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
