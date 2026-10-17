import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Min,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../enums/payment-method.enum';

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
 * Payload for recording a new payment on a DRAFT sale.
 *
 * Multi-tender: a sale can have multiple payments (e.g. Rs. 400 on card
 * + Rs. 550 cash). Each payment is a single tender.
 *
 * Validation notes:
 *   - amount is bounded above at the service by (Sale.total - SUM of
 *     other payments) — DTO can't enforce because it doesn't know sale
 *     context. Service throws 400 on overpayment.
 *   - cash_received: REQUIRED when payment_method = CASH, must be >=
 *     amount. FORBIDDEN when payment_method != CASH. Cross-field rule
 *     enforced at the service (DTO can't see the method+field pair
 *     conditionally without ugly ValidateIf chains).
 *   - reference_number: REQUIRED at the service for all methods except
 *     CASH. Nullable in the DB so future methods without references
 *     don't need a migration.
 *
 * Server-owned fields not accepted from client:
 *   - id, sale_id (URL path parameter), created_at, updated_at
 *   - trade_in_phone_purchase_id: populated by completeSale after the
 *     PhonePurchase is materialized (Slice G).
 *
 * TRADE_IN payments carry five additional optional-at-DTO fields
 * (trade_in_product_id, trade_in_imei, trade_in_buying_price,
 * trade_in_selling_price, trade_in_notes). Service enforces the
 * required trio when payment_method = TRADE_IN and rejects them
 * outright for any other method. During DRAFT, trade-in data lives
 * on the payment row; the PhonePurchase, ProductUnit, and Stock
 * increment are materialized atomically at completeSale.
 */
export class AddPaymentDto {
  @ApiProperty({
    enum: PaymentMethod,
    example: PaymentMethod.CASH,
    description:
      'How the customer tendered. CASH is the only method where ' +
      'cash_received > amount is allowed (the excess is change). ' +
      'CARD, BANK_TRANSFER, KOKO, MINTPAY all require reference_number.',
  })
  @IsEnum(PaymentMethod)
  payment_method!: PaymentMethod;

  @ApiProperty({
    example: 550.0,
    description:
      'Money applied to the sale from this tender. Must be > 0. Bounded ' +
      'above by (Sale.total - SUM of other payments) — the service ' +
      'returns 400 if this would push amount_paid over the sale total.',
    minimum: 0.01,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({
    example: 600.0,
    description:
      'Physical cash handed over by the customer. REQUIRED when ' +
      'payment_method = CASH; must be >= amount. MUST NOT be sent for ' +
      'any other method. Change = cash_received - amount is computed ' +
      'at receipt time (not stored).',
    minimum: 0.01,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  cash_received?: number;

  @ApiPropertyOptional({
    example: 'AUTH-482913',
    description:
      'Reference number for reconciliation. REQUIRED at service for ' +
      'CARD (terminal auth code / RRN), BANK_TRANSFER (slip reference), ' +
      'KOKO / MINTPAY (provider transaction ID). Optional for CASH. ' +
      'Empty string normalizes to null.',
    maxLength: 100,
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference_number?: string;

  @ApiPropertyOptional({
    example: 'Split tender, customer paid Rs. 400 on card',
    description: 'Free-form cashier notes. Empty string normalizes to null.',
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  notes?: string;

  // ---- Trade-in fields (required when payment_method = TRADE_IN) ----
  //
  // Service enforces:
  //   - all of product_id + imei + buying_price present ONLY when
  //     payment_method = TRADE_IN
  //   - amount === trade_in_buying_price to the cent
  //   - trade_in_product_id refers to a serialized product at the sale's
  //     branch
  //   - trade_in_imei doesn't collide with an existing ProductUnit (409)
  // DTO can't enforce cross-field "required iff TRADE_IN" cleanly, so
  // we mark each nullable at the DTO layer and let the service reject
  // wrong combinations with a clear message. IMEI regex + length mirror
  // CreatePhonePurchaseDto for symmetry.

  @ApiPropertyOptional({
    example: '33333333-3333-3333-3333-333333333333',
    description:
      'TRADE_IN only. The used-phone product SKU being traded in. Must ' +
      "exist, be active, be at the sale's branch, and have " +
      'is_serialized = true. Rejected with 400 if payment_method is not ' +
      'TRADE_IN.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  trade_in_product_id?: string;

  @ApiPropertyOptional({
    example: '356938035643809',
    description:
      'TRADE_IN only. IMEI of the trade-in phone. Must not belong to a ' +
      'unit the shop holds (IN_STOCK / WRITTEN_OFF); collision returns ' +
      '409 with the existing_unit payload at addPayment (best-effort) and ' +
      'again at completeSale. A SOLD or RETURNED unit does not block: ' +
      'buying back a phone we sold creates a new ProductUnit row. Same ' +
      '8-50 char, letters+digits regex as CreatePhonePurchaseDto.',
    minLength: 8,
    maxLength: 50,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'trade_in_imei must contain only letters and digits',
  })
  trade_in_imei?: string;

  @ApiPropertyOptional({
    example: 60000.0,
    description:
      'TRADE_IN only. Amount we are paying the customer for this phone. ' +
      'MUST equal `amount` to the cent (service checks; DB CHK backstops). ' +
      'Must be >= 0.01 (see @Min on amount).',
    minimum: 0.01,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  trade_in_buying_price?: number;

  @ApiPropertyOptional({
    example: 75000.0,
    description:
      'TRADE_IN only. Optional per-unit selling price override for the ' +
      'materialized ProductUnit. If omitted, ProductUnit.selling_price ' +
      'stays null and the next sale of this phone falls back to ' +
      'Product.selling_price at ring-up time. Must be >= 0.01 when ' +
      'sent: a stored 0 would ring the phone up for free on resale ' +
      '(the fallback only applies to null).',
    minimum: 0.01,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  trade_in_selling_price?: number;

  @ApiPropertyOptional({
    example: 'Screen scratch top-right, battery health 89%, no box',
    description:
      'TRADE_IN only. Free-form cashier assessment notes at intake. ' +
      'Empty string normalizes to null.',
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  trade_in_notes?: string;
}
