import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
 * Payload for adding a new line to a DRAFT sale.
 *
 * Snapshot fields (product_sku_snapshot, product_name_snapshot,
 * unit_price, cost_price_snapshot) are NEVER accepted from the client —
 * they are resolved server-side from the product record at add-time.
 * This prevents a client from ringing up a Rs. 200,000 phone at Rs. 10.
 *
 * discount_type and discount_value must both be present or both
 * absent — enforced by the service and by
 * CHK_sale_lines_discount_consistency at the DB.
 *
 * discount_amount is NEVER accepted from the client — the server resolves
 * it from (type, value, unit_price * quantity). Trusting the client's
 * discount_amount would allow arbitrary price manipulation.
 *
 * line_number is server-assigned as max(line_number) + 1 within the sale.
 */
export class AddSaleLineDto {
  @ApiProperty({
    example: '33333333-3333-3333-3333-333333333333',
    description:
      'Product to add. Must exist, be active, and belong to the same ' +
      'branch as the sale. Snapshot fields are resolved from this product.',
    format: 'uuid',
  })
  @IsUUID()
  product_id!: string;

  @ApiProperty({
    example: 2,
    description:
      'Units of the product on this line. Must be a positive integer.',
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    enum: DiscountType,
    example: DiscountType.PERCENT,
    description:
      'How the line-level discount is expressed. If provided, ' +
      'discount_value must also be provided.',
  })
  @IsOptional()
  @IsEnum(DiscountType)
  discount_type?: DiscountType;

  @ApiPropertyOptional({
    example: 10,
    description:
      'Raw discount value. For AMOUNT: LKR off the line (e.g. 500 = ' +
      'Rs. 500 off). For PERCENT: percentage 0–100. If provided, ' +
      'discount_type must also be provided. Server-computed ' +
      'discount_amount is capped at unit_price × quantity.',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount_value?: number;

  @ApiPropertyOptional({
    example: '44444444-4444-4444-4444-444444444444',
    description:
      'Optional supplier this specific line was sourced from (friendly-shop ' +
      'sourcing). Must be an active supplier. When set, stock hooks in ' +
      'Slice F skip decrementing our own stock for this line.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  external_supplier_id?: string;

  @ApiPropertyOptional({
    example: '354789102345678',
    description:
      'IMEI of the specific unit sold (for serialized products like phones). ' +
      'Free-text in Phase 6.3; will be validated against ProductUnit records ' +
      'in Phase 6.3.5. Empty string is normalized to null.',
    maxLength: 50,
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  imei_snapshot?: string;
}
