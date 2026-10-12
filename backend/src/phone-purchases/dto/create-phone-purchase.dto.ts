import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
 * Normalize a required string field: trim whitespace. Empty string
 * stays empty and fails MinLength; null/undefined passes through
 * for @IsString / required-field enforcement to catch.
 */
const trimRequiredStringField = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

/**
 * Payload for creating a new PhonePurchase (intake of a used phone
 * from a customer).
 *
 * One PhonePurchase = one physical phone at intake time. The service
 * creates the PhonePurchase row AND its corresponding ProductUnit
 * (status IN_STOCK) AND increments the Stock row for
 * (product_id, branch_id), all in one atomic transaction.
 *
 * Server-owned fields not accepted from client:
 *   - id, cashier_id (from JWT), total_amount (derived from
 *     buying_price for now — one unit per purchase), created_at,
 *     updated_at
 *
 * Cross-entity validation happens at the service:
 *   - customer_id must exist and not be soft-deleted
 *   - branch_id must exist, be active, and (for non-admin cashiers)
 *     must match the caller's own branch
 *   - product_id must exist, be active, belong to branch_id, and
 *     have is_serialized = true
 *   - imei must not collide with any existing ProductUnit
 *     (regardless of that unit's status) — 409 with existing_unit
 *     payload on conflict
 */
export class CreatePhonePurchaseDto {
  @ApiProperty({
    example: '22222222-2222-2222-2222-222222222222',
    description:
      'Customer we are buying the phone from. Must exist and not be ' +
      'soft-deleted. Frontend resolves the customer separately (via ' +
      'GET /customers?search=... or POST /customers) and passes the ' +
      'resolved UUID here.',
    format: 'uuid',
  })
  @IsUUID()
  customer_id!: string;

  @ApiProperty({
    example: '11111111-1111-1111-1111-111111111111',
    description:
      'Branch the intake takes place at. Must be an active branch. ' +
      "For non-admin cashiers this must match the caller's own " +
      'assigned branch — attempting to intake at a different branch ' +
      'returns 403. Admins can intake at any branch.',
    format: 'uuid',
  })
  @IsUUID()
  branch_id!: string;

  @ApiProperty({
    example: '33333333-3333-3333-3333-333333333333',
    description:
      'Product SKU this phone represents. Must exist, be active, ' +
      'belong to branch_id, and have is_serialized = true. Cashier ' +
      'picks from existing products — creating a new product ' +
      'from intake is a future admin-only flow.',
    format: 'uuid',
  })
  @IsUUID()
  product_id!: string;

  @ApiProperty({
    example: '356938035643809',
    description:
      'IMEI of the physical phone being intaken. Globally unique — ' +
      'collides with any existing ProductUnit (IN_STOCK, SOLD, ' +
      'RETURNED, or WRITTEN_OFF) return 409 with a structured ' +
      'existing_unit payload. Trimmed on input; typically 15 digits ' +
      'but 8–50 chars accepted for older devices and edge cases.',
    minLength: 8,
    maxLength: 50,
  })
  @Transform(trimRequiredStringField)
  @IsString()
  @MinLength(8)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'imei must contain only letters and digits',
  })
  imei!: string;

  @ApiProperty({
    example: 80000.0,
    description:
      'Amount we are paying the customer for this phone. Must be >= 0. ' +
      'Stored on both PhonePurchase.total_amount and ' +
      'ProductUnit.buying_price (they are equal for single-unit ' +
      'purchases, which is all Slice D supports).',
    minimum: 0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  buying_price!: number;

  @ApiPropertyOptional({
    example: 100000.0,
    description:
      'Optional per-unit selling price override. If omitted or null, ' +
      'ProductUnit.selling_price stays null and the sale flow falls ' +
      'back to Product.selling_price at ring-up time. Cashier sets ' +
      "this at intake when they can assess the specific unit's " +
      'condition-adjusted price; otherwise defer to admin post-intake.',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  selling_price?: number;

  @ApiPropertyOptional({
    example: 'Screen scratch top-right, battery health 89%, no box',
    description:
      'Free-form cashier assessment notes. Empty string normalizes ' +
      'to null.',
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  notes?: string;
}
