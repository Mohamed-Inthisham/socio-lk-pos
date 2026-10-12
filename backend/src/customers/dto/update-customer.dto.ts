import { ApiPropertyOptional } from '@nestjs/swagger';
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
 * Payload for PATCH /customers/:id.
 *
 * REST PATCH semantics (codebase convention):
 * - Field omitted (undefined) → don't touch.
 * - Field explicitly null → clear (only meaningful for nullable columns).
 * - Field with value → set.
 *
 * name and phone are non-nullable in the DB, so they can be updated but
 * not cleared. nic and notes are nullable and support null-to-clear.
 *
 * Hand-written rather than PartialType(CreateCustomerDto) because
 * PartialType would carry the "required" nature of name/phone into
 * Swagger docs even after they're made optional. Manual DTOs match the
 * per-field REST semantics precisely (codebase convention from
 * Phase 6.1/6.3).
 */
export class UpdateCustomerDto {
  @ApiPropertyOptional({
    description: 'Customer full name.',
    example: 'Kamal Perera',
    minLength: 1,
    maxLength: 200,
  })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Sri Lankan phone number. Accepts 0771234567, +94771234567, or 94771234567; normalized to 0XXXXXXXXX.',
    example: '0771234567',
  })
  @Transform(({ value }): unknown => {
    if (typeof value !== 'string') return value;
    const normalized = normalizeSlPhone(value);
    return normalized ?? value.trim();
  })
  @IsOptional()
  @IsString()
  @Length(10, 10, {
    message:
      'phone must be a valid Sri Lankan number (e.g. 0771234567 or +94771234567)',
  })
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Sri Lankan National ID. Pass null to clear. Unique across all customers when present.',
    example: '199012345678',
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

  @ApiPropertyOptional({
    description: 'Free-form notes. Pass null to clear.',
    example: 'Prefers WhatsApp for follow-ups.',
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
