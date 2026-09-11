import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * Request body for POST /sales/:id/void.
 *
 * The sole required field is void_reason — a free-text explanation of
 * why the sale is being reversed. Accountability control: every void
 * lands in the ledger with a stated reason, so audits can distinguish
 * "customer returned defective phone" from "cashier mis-rang, corrected
 * immediately" from anything that looks like fraud.
 *
 * Trim + non-empty is enforced at three layers, deliberately redundant:
 *   1. DTO: @Transform strips whitespace, @MinLength(3) rejects trivially
 *      short reasons ("no", "x", "  ").
 *   2. Service: extra guard when calling the service directly (tests,
 *      future internal callers).
 *   3. DB: CHK_sales_voided_consistency requires
 *      length(trim(void_reason)) > 0 for VOIDED rows.
 *
 * MinLength(3) chosen over MinLength(1) because a single letter is
 * almost never a real reason. 3 is short enough to allow legitimate
 * abbreviations ("N/A" would fail but nothing legit is 3 chars — the
 * real floor is "wrong item" territory). Adjust down if the frontend
 * team pushes back.
 *
 * MaxLength(500) is a soft-cap: void reasons that need a novel belong
 * in an incident report, not a POS field. Prevents accidental
 * multi-megabyte pastes from bricking a receipt render later.
 *
 * voided_by is NOT in this DTO — it comes from @CurrentUser in the
 * controller. Same pattern as cashier_id on sale creation. A cashier
 * (or manager) cannot attribute a void to someone else.
 */
export class VoidSaleDto {
  @ApiProperty({
    description:
      'Reason for voiding this sale. Required, trimmed, 3–500 chars. ' +
      'Recorded on both the Sale (void_reason) and every Payment ' +
      '(reversal_reason) in the same transaction.',
    example: 'Customer returned defective phone within warranty window',
    minLength: 3,
    maxLength: 500,
  })
  @IsString({ message: 'void_reason must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(3, {
    message: 'void_reason must be at least 3 characters after trimming',
  })
  @MaxLength(500, { message: 'void_reason must be at most 500 characters' })
  void_reason!: string;
}
