import {
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../enums/user-role.enum';

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
    description: 'User password (bcrypt-hashed on server)',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password cannot exceed 72 characters' })
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

  @ApiPropertyOptional({
    enum: UserRole,
    example: UserRole.CASHIER,
    description: 'User role — defaults to CASHIER if omitted',
  })
  @IsOptional()
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
  @IsOptional()
  @IsUUID(undefined, { message: 'branch_id must be a valid UUID' })
  branch_id?: string;
}
