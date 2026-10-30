import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ResetPasswordDto } from './reset-password.dto';

/**
 * PUT /auth/me/password: a user changes their own password. The current
 * password is checked as on login and on PUT /auth/me/approval-pin (no
 * byte limit: it is compared, never hashed); new_password follows
 * ResetPasswordDto. No confirmation field: no DTO here has one, and
 * matching two typed copies is the form's job. Messages never echo a value.
 */
export class ChangePasswordDto extends ResetPasswordDto {
  @ApiProperty({ description: 'Your current login password.' })
  @IsString({ message: 'current_password is required' })
  @MinLength(1, { message: 'current_password is required' })
  @MaxLength(72, { message: 'current_password is too long' })
  current_password!: string;
}
