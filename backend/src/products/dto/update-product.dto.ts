import { PartialType } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';
import { IsOptionalNotNull } from '../../common/validators/is-optional-not-null.decorator';

/**
 * All fields from CreateProductDto are optional in update, PLUS `sku`
 * is allowed here (only in updates — never in creates).
 * See decision doc: SKU is always auto-generated on create, but admin
 * can rename it on update for corrections/migrations.
 *
 * skipNullProperties: false — an omitted field is left alone, but null
 * runs the field's validators, so null on a NOT NULL column is a 400
 * rather than a 500 (or, for brand_id / category_id / branch_id, a silent
 * no-op). Fields optional on create but NOT NULL in the table (barcode,
 * barcode_type, default_warranty, is_serialized, is_active) carry
 * @IsOptionalNotNull in CreateProductDto; nullable ones (description,
 * phone_*) keep @IsOptional, so null still clears them.
 */
export class UpdateProductDto extends PartialType(CreateProductDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({
    example: 'SKU-000047',
    description:
      'SKU. Can only be changed on update, never provided on create. ' +
      'Must remain unique. Auto-generated SKUs continue from the counter — ' +
      'manual overrides do not reset the counter.',
    minLength: 1,
    maxLength: 30,
  })
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  sku?: string;
}
