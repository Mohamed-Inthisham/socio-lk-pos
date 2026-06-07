import {
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
} from 'class-validator';
import { UserRole } from '../enums/user-role.enum';

export class CreateUserDto {
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password cannot exceed 72 characters' })
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  full_name!: string;

  @IsOptional()
  @IsEnum(UserRole, {
    message: `Role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  role?: UserRole;
}
