import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MaxUtf8Bytes } from '../../common/validators/max-utf8-bytes.decorator';
import {
  BCRYPT_MAX_INPUT_BYTES,
  PASSWORD_TOO_LONG_MESSAGE,
} from '../../common/bcrypt-input';

/**
 * POST /users/:id/password: an admin sets another user's password. The
 * same rules as CreateUserDto.password. Messages never echo the value.
 */
export class ResetPasswordDto {
  @ApiProperty({
    example: 'newSecurePass123',
    description:
      'The new password. At least 8 characters and at most 72 bytes in ' +
      'UTF-8: bcrypt ignores anything beyond, so a longer password is ' +
      'refused rather than truncated.',
    minLength: 8,
  })
  @IsString({ message: 'new_password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxUtf8Bytes(BCRYPT_MAX_INPUT_BYTES, { message: PASSWORD_TOO_LONG_MESSAGE })
  new_password!: string;
}
