import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PIN_PATTERN } from '../weak-pin';

/**
 * PUT /auth/me/approval-pin (Phase 6.4 P6-18). The current password proves
 * it's the user; the weak-PIN rule is applied by the service. Messages
 * never echo either value.
 */
export class SetApprovalPinDto {
  @ApiProperty({ description: 'Your current login password.' })
  @IsString({ message: 'current_password is required' })
  @MinLength(1, { message: 'current_password is required' })
  @MaxLength(72, { message: 'current_password is too long' })
  current_password!: string;

  @ApiProperty({
    description:
      'The new 6-digit PIN. All-one-digit PINs and straight runs ' +
      '(123456, 654321) are refused.',
    example: '482916',
  })
  @IsString({ message: 'pin must be exactly 6 digits' })
  @Matches(PIN_PATTERN, { message: 'pin must be exactly 6 digits' })
  pin!: string;
}
