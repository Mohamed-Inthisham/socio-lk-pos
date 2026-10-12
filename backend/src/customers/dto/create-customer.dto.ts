import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { normalizeSlPhone } from '../../common/utils/sl-phone';

/**
 * Payload for POST /customers.
 *
 * Normalization:
 * - Trims all string fields.
 * - Empty strings on optional fields normalize to null (never "").
 * - phone normalizes to canonical 0XXXXXXXXX form via normalizeSlPhone;
 *   invalid phones fall through to fail validation on the length check.
 *
 * Validation choices:
 * - name required, 1..200 chars.
 * - phone required, must normalize to valid SL number (10 digits, 0[1-9]...).
 *   We normalize inside @Transform so downstream code always sees the
 *   canonical form.
 * - nic optional; when present must be 5..20 chars. We deliberately DO
 *   NOT enforce the exact SL NIC formats here (old 9-digit + letter,
 *   new 12-digit) because format edge cases (foreigners, temporary IDs)
 *   would create false rejections at intake. Format-strict validation
 *   can land later as a followup if needed.
 * - notes optional, max 1000 chars.
 */
export class CreateCustomerDto {
  @ApiProperty({
    description: 'Customer full name.',
    example: 'Kamal Perera',
    minLength: 1,
    maxLength: 200,
  })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({
    description:
      'Sri Lankan phone number. Accepts 0771234567, +94771234567, or 94771234567; normalized to 0XXXXXXXXX.',
    example: '0771234567',
  })
  @Transform(({ value }): unknown => {
    if (typeof value !== 'string') return value;
    const normalized = normalizeSlPhone(value);
    // If normalization fails, return the trimmed original so the length
    // check produces a meaningful error rather than a null-coerce crash.
    return normalized ?? value.trim();
  })
  @IsString()
  @Length(10, 10, {
    message:
      'phone must be a valid Sri Lankan number (e.g. 0771234567 or +94771234567)',
  })
  phone!: string;

  @ApiProperty({
    description:
      'Sri Lankan National ID. Unique across all customers when present. Optional at intake.',
    example: '199012345678',
    required: false,
    nullable: true,
  })
  @Transform(({ value }): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed.toUpperCase();
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(5, 20)
  nic?: string | null;

  @ApiProperty({
    description: 'Free-form notes about the customer (preferences, history).',
    example: 'Prefers WhatsApp for follow-ups.',
    required: false,
    nullable: true,
    maxLength: 1000,
  })
  @Transform(({ value }): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
