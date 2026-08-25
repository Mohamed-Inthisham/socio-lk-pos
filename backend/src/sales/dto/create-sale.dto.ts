import { IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Normalize an optional string field: trim whitespace, convert empty
 * strings to null. Same pattern as CreateSupplierDto.trimStringField.
 * REST PATCH semantics: undefined = don't touch, null = clear, string = set.
 */
const trimStringField = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Payload for creating a new DRAFT sale.
 *
 * cashier_id is NOT accepted from the client — it comes from the JWT
 * of the authenticated user calling the endpoint. This prevents a
 * cashier from creating a sale attributed to someone else.
 *
 * status is not accepted either — new sales are always DRAFT.
 * sale_type defaults to RETAIL server-side (only value wired in 6.3).
 */
export class CreateSaleDto {
  @ApiProperty({
    example: '11111111-1111-1111-1111-111111111111',
    description:
      'Branch the sale takes place at. Must be an active branch. ' +
      'For staff users the frontend will typically send their own branch_id.',
    format: 'uuid',
  })
  @IsUUID()
  branch_id!: string;

  @ApiPropertyOptional({
    example: '22222222-2222-2222-2222-222222222222',
    description:
      'Customer this sale is for. Nullable — walk-in customers have no ' +
      'customer_id. Customer entity lands in Phase 6.3.5; until then, ' +
      'sending a random UUID is accepted but not FK-validated.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @ApiPropertyOptional({
    example: 'Customer wants a receipt SMS',
    description: 'Free-form cashier notes. Empty string is normalized to null.',
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  notes?: string;
}
