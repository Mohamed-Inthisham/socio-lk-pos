import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';
import { PIN_PATTERN } from '../weak-pin';

/**
 * A manager's approval, sent with an action that needs one (a void now,
 * returns in P7): who approves, and their PIN (Phase 6.4 P6-17).
 *
 * Validation messages name the field, never its value, so a malformed PIN
 * is never echoed back.
 */
export class ApprovalDto {
  @ApiProperty({
    description:
      'The approving admin or manager (from GET /approvers); may be the ' +
      'session user.',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'approver_id must be a UUID' })
  approver_id!: string;

  @ApiProperty({
    description: "The approver's 6-digit approval PIN.",
    example: '482916',
  })
  @IsString({ message: 'pin must be exactly 6 digits' })
  @Matches(PIN_PATTERN, { message: 'pin must be exactly 6 digits' })
  pin!: string;
}
