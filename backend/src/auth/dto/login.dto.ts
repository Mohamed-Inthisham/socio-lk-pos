import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Password is required' })
  @MaxLength(72)
  password!: string;
}
