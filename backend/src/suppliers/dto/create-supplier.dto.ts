import {
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  IsBoolean,
  Matches,
  IsEmail,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSupplierDto {
  @ApiProperty({
    example: 'Ranjith Mobile',
    description: 'Supplier display name (case-insensitively unique)',
    minLength: 1,
    maxLength: 150,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({
    example: 'Ranjith Perera',
    description: 'Human contact person at the supplier',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contact_person?: string;

  @ApiPropertyOptional({
    example: '0771234567',
    description: 'Sri Lankan phone number in format 0XXXXXXXXX',
  })
  @IsOptional()
  @IsString()
  @Matches(/^0\d{9}$/, {
    message: 'phone must be a valid Sri Lankan number (0XXXXXXXXX)',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: 'ranjith@shop.lk',
    description: 'Supplier email (soft-validated)',
    maxLength: 255,
  })
  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    example: 'No 45, Galle Road, Colombo 03',
    description: 'Free-form supplier address',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    example: 'Payment on delivery, 30-day terms',
    description: 'Internal notes about the supplier',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the supplier is active — defaults to true if omitted',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
