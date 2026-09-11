import { IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Normalize an optional string field: trim whitespace, convert empty
 * strings to null (clear the field).
 */
const trimStringField = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Payload for updating a DRAFT sale. Only sale-level fields can be
 * changed via this endpoint — lines and payments have their own
 * sub-resource endpoints (POST/PATCH/DELETE /sales/:id/lines/:lineId etc,
 * landing in Slices D and E).
 *
 * DRAFT-only: the service rejects updates to COMPLETED or VOIDED sales
 * with a 400.
 *
 * branch_id is intentionally NOT here. A cashier accidentally reassigning
 * a cart to a different branch mid-sale would create a stock/audit mess.
 * If a cashier wants to switch branch context, they discard the DRAFT
 * and start a new one. Also — for staff users the branch is
 * locked to their assigned branch anyway.
 */
export class UpdateSaleDto {
  @ApiPropertyOptional({
    example: '22222222-2222-2222-2222-222222222222',
    description:
      'Change the customer this sale is for. Send null to clear. ' +
      'Customer entity lands in 6.3.5; until then, no FK validation.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  customer_id?: string | null;

  @ApiPropertyOptional({
    example: 'Updated note',
    description:
      'Change the cashier notes. Send empty string or null to clear.',
    nullable: true,
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  notes?: string | null;
}
