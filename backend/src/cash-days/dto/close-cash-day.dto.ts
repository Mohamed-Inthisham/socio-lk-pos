import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimmedOrNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

/**
 * Request body for POST /cash-days/:id/close (Phase 6.4 P9-11). Shape
 * checks only (C1). difference_reason is checked here only for type and
 * length (at most 500): whether it is needed depends on the difference,
 * which only the server works out, so the 3-character minimum is the
 * service's 400 REASON_REQUIRED, and only when the difference is 1.00 or
 * more either way (the rounding rule).
 */
export class CloseCashDayDto {
  @ApiProperty({
    description:
      'The cash counted in the box: a number, at least 0, at most 2 decimals.',
    minimum: 0,
    example: 12500,
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'counted_balance must be a number with at most 2 decimals' },
  )
  @Min(0, { message: 'counted_balance must be at least 0' })
  @Max(9999999999.99, {
    message: 'counted_balance must be at most 9999999999.99',
  })
  counted_balance!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Why counted and expected differ: required (3+ characters after ' +
      'trimming) when they differ by 1.00 or more (400 REASON_REQUIRED); ' +
      'ignored and stored null under 1.00 (the rounding rule).',
    maxLength: 500,
    example: 'LKR 3,000 bank deposit',
  })
  @Transform(trimmedOrNull)
  @IsOptional()
  @IsString({ message: 'difference_reason must be a string' })
  @MaxLength(500, {
    message: 'difference_reason must be at most 500 characters',
  })
  difference_reason?: string | null;

  @ApiProperty({
    description:
      'The expected balance the dialog showed. If the server works out a ' +
      'different one under the lock: 409 EXPECTED_CHANGED with the fresh ' +
      'summary. A number, at most 2 decimals; may be negative.',
    example: 15500,
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'expected_seen must be a number with at most 2 decimals' },
  )
  @Min(-9999999999.99, {
    message: 'expected_seen must be at least -9999999999.99',
  })
  @Max(9999999999.99, {
    message: 'expected_seen must be at most 9999999999.99',
  })
  expected_seen!: number;

  @ApiProperty({
    description:
      "The till's id for this close (one per dialog, resent with every " +
      'attempt, P9-18): a resend from the same user for the same day gets ' +
      'the closed day back (200).',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'client_request_id must be a UUID' })
  client_request_id!: string;
}
