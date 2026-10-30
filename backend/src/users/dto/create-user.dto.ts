import {
  IsEmail,
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../enums/user-role.enum';
import { IsOptionalNotNull } from '../../common/validators/is-optional-not-null.decorator';
import { MaxUtf8Bytes } from '../../common/validators/max-utf8-bytes.decorator';
import {
  BCRYPT_MAX_INPUT_BYTES,
  PASSWORD_TOO_LONG_MESSAGE,
} from '../../common/bcrypt-input';
import { normalizeSlPhone } from '../../common/utils/sl-phone';
import {
  normalizeSlNic,
  SL_NIC_MESSAGE,
  SL_NIC_PATTERN,
} from '../../common/utils/sl-nic';

export const USER_ADDRESS_MAX_LENGTH = 500;
const PHONE_MESSAGE =
  'Contact number must be a valid Sri Lankan number (e.g. 0771234567 or +94771234567)';

/** Trimmed, so an all-spaces value fails MinLength. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @ApiProperty({
    example: 'cashier@socio.lk',
    description: 'User email address (must be unique)',
    maxLength: 255,
  })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'securePass123',
    description:
      'User password (bcrypt-hashed on server). At least 8 characters and ' +
      'at most 72 bytes in UTF-8: bcrypt ignores anything beyond, so a ' +
      'longer password is refused rather than truncated.',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxUtf8Bytes(BCRYPT_MAX_INPUT_BYTES, { message: PASSWORD_TOO_LONG_MESSAGE })
  password!: string;

  @ApiProperty({
    example: 'Jane Perera',
    description: 'User full name',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  full_name!: string;

  // Contact details (Task 2.5): required here; on PATCH (UpdateUserDto)
  // each may be left out, but null or an empty value is a 400, so once
  // set they can be changed and never cleared.
  @ApiProperty({
    example: '0771234567',
    description:
      'Sri Lankan contact number. Accepts 0771234567, +94771234567 or ' +
      '94771234567 (spaces and dashes allowed); stored as 0XXXXXXXXX.',
  })
  @Transform(({ value }): unknown => {
    if (typeof value !== 'string') return value;
    // An invalid number stays as typed so the check below reports it.
    return normalizeSlPhone(value) ?? value.trim();
  })
  @IsString({ message: PHONE_MESSAGE })
  @Matches(/^0[1-9]\d{8}$/, { message: PHONE_MESSAGE })
  phone!: string;

  @ApiProperty({
    example: '199012345678',
    description:
      'Sri Lankan NIC: 9 digits + V or X, or 12 digits. Stored uppercase. ' +
      'Unique among users (409 NIC_ALREADY_REGISTERED).',
  })
  @Transform(({ value }): unknown => normalizeSlNic(value))
  @IsString({ message: SL_NIC_MESSAGE })
  @Matches(SL_NIC_PATTERN, { message: SL_NIC_MESSAGE })
  nic!: string;

  @ApiProperty({
    example: '12 Temple Road, Kandy',
    description: 'Home address. Trimmed.',
    maxLength: USER_ADDRESS_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString({ message: 'Address is required' })
  @MinLength(1, { message: 'Address is required' })
  @MaxLength(USER_ADDRESS_MAX_LENGTH, {
    message: `Address must be at most ${USER_ADDRESS_MAX_LENGTH} characters`,
  })
  address!: string;

  @ApiPropertyOptional({
    enum: UserRole,
    example: UserRole.CASHIER,
    description: 'User role — defaults to CASHIER if omitted',
  })
  @IsOptionalNotNull()
  @IsEnum(UserRole, {
    message: `Role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  role?: UserRole;

  @ApiPropertyOptional({
    example: 'c5f4e0f2-3456-789a-bcde-f23456789012',
    description:
      'Branch UUID. REQUIRED for manager and cashier roles, ' +
      'FORBIDDEN for admin role. Admins are un-branched and see all branches.',
    format: 'uuid',
  })
  // Not @IsOptional: null is never a valid branch_id here (an admin omits
  // it, staff must have one), and on PATCH it used to reach the service
  // and end in a 500 on CHK_users_branch_role.
  @IsOptionalNotNull()
  @IsUUID(undefined, { message: 'branch_id must be a valid UUID' })
  branch_id?: string;
}
