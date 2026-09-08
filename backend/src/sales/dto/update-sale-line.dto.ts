import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '../enums/discount-type.enum';

/**
 * Normalize an optional string field: trim whitespace, convert empty
 * strings to null. Same pattern as CreateSaleDto.
 */
const trimStringField = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Payload for updating an existing line on a DRAFT sale.
 *
 * REST PATCH semantics:
 *   - undefined = don't touch
 *   - null = clear (only meaningful for nullable fields)
 *   - value = set
 *
 * DELIBERATELY NOT UPDATABLE via this DTO:
 *   - product_id: changing the product on an existing line is really a
 *     "remove and re-add" operation. Cleaner audit trail if the cashier
 *     does exactly that.
 *   - unit_price: frozen at snapshot time. If a cashier wants to
 *     negotiate a different price, remove the line and re-add it (fresh
 *     snapshot from current product price). Allowing arbitrary unit_price
 *     edits opens a fraud vector.
 *   - product_sku_snapshot / product_name_snapshot / cost_price_snapshot:
 *     ditto — snapshots are frozen for the life of the line.
 *   - line_number: assigned once at add-time. Renumbering serves no
 *     business purpose and would break receipt references.
 *   - discount_amount / line_total: server-computed. Client never sends.
 *
 * Discount clearing: pass BOTH discount_type: null and discount_value: null
 * to remove a line's discount. Passing only one raises 400.
 */
export class UpdateSaleLineDto {
  @ApiPropertyOptional({
    example: 3,
    description: 'New quantity for this line. Must be a positive integer.',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  // Nullable — pass null to clear the discount.
  // ValidateIf ensures IsEnum only runs when a value is actually provided;
  // without it, class-validator rejects null as "not a valid enum value."
  @ApiPropertyOptional({
    enum: DiscountType,
    nullable: true,
    example: DiscountType.AMOUNT,
    description:
      'Discount type. Pass null (together with discount_value: null) to ' +
      'clear the line discount. If set, discount_value must also be set.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(DiscountType)
  discount_type?: DiscountType | null;

  @ApiPropertyOptional({
    example: 500,
    nullable: true,
    description:
      'Raw discount value. Pass null (together with discount_type: null) ' +
      'to clear the line discount. See AddSaleLineDto for units.',
    minimum: 0,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount_value?: number | null;

  @ApiPropertyOptional({
    example: '44444444-4444-4444-4444-444444444444',
    nullable: true,
    description:
      'Change or clear the external supplier for this line. Pass null to ' +
      'switch back to internal stock sourcing.',
    format: 'uuid',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  external_supplier_id?: string | null;

  @ApiPropertyOptional({
    example: '354789102345678',
    nullable: true,
    description:
      'Change or clear the IMEI snapshot. Empty string normalizes to null.',
    maxLength: 50,
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  imei_snapshot?: string | null;
}
