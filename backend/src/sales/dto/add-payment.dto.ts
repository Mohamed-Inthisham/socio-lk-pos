import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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
}
