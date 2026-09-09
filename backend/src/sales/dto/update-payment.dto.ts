import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
 * Payload for updating an existing payment on a DRAFT sale.
 *
 * REST PATCH semantics:
 *   - undefined = don't touch
 *   - null = clear (only meaningful for nullable fields)
 *   - value = set
 *
 * DELIBERATELY NOT UPDATABLE via this DTO:
 *   - payment_method: frozen at record time. Changing "CASH" to "CARD"
 *     mid-payment is not a small edit — it's a different transaction.
 *     Remove and re-add for a clean audit trail (the CASH payment shows
 *     as a reversal, the CARD payment shows as new activity).
 *   - sale_id: fixed at creation.
 *   - id, created_at: server-owned.
 *
 * Cross-field rules enforced at the SERVICE against the merged (existing
 * + DTO) state:
 *   - If effective payment_method is CASH: cash_received must remain
 *     non-null and >= effective amount.
 *   - If effective payment_method is not CASH: cash_received must remain
 *     null (attempting to set it raises 400).
 *   - reference_number: cannot be cleared for non-CASH methods (would
 *     leave a card sale un-reconcilable).
 *   - amount: bounded above by (Sale.total - SUM of OTHER payments).
 *     "Other" excludes the payment being updated.
 */
export class UpdatePaymentDto {
  @ApiPropertyOptional({
    example: 600.0,
    description:
      'New amount applied to the sale. Bounded above by remaining ' +
      'balance (Sale.total - other payments). Must be > 0.',
    minimum: 0.01,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({
    example: 700.0,
    nullable: true,
    description:
      'New physical cash amount handed over (CASH payments only). Pass ' +
      'null only on CASH-tender edits that also change amount such that ' +
      'the receipt should just show amount (rare — service will reject ' +
      'if effective payment_method is CASH and cash_received is null). ' +
      'MUST NOT be set for non-CASH methods.',
    minimum: 0.01,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  cash_received?: number | null;

  @ApiPropertyOptional({
    example: 'AUTH-482913',
    nullable: true,
    description:
      'Update or clear the reference number. Clearing is rejected for ' +
      'CARD/BANK_TRANSFER/KOKO/MINTPAY (they need references for ' +
      'reconciliation). Empty string normalizes to null.',
    maxLength: 100,
  })
  @Transform(trimStringField)
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  reference_number?: string | null;

  @ApiPropertyOptional({
    example: 'Recount: customer originally gave 1000, corrected to 700',
    nullable: true,
    description:
      'Update or clear the cashier notes. Empty string normalizes to null.',
  })
  @Transform(trimStringField)
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  notes?: string | null;
}
