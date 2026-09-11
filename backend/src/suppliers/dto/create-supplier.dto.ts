import {
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  IsBoolean,
  Matches,
  IsEmail,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Normalize a string field: trim whitespace, convert empty strings to null
 * so the service layer receives an explicit "clear this field" signal on
 * update, while validation (@IsEmail, @Matches, etc.) still short-circuits
 * via @IsOptional() which treats null the same as undefined.
 *
 * REST PATCH semantics: undefined = don't touch, null = clear, string = set.
 */
const trimStringField = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export class CreateSupplierDto {
  @ApiProperty({
    example: 'Ranjith Mobile',
    description: 'Supplier display name (case-insensitively unique)',
    minLength: 1,
    maxLength: 150,
  })
  @Transform(trimStringField)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({
    example: 'Ranjith Perera',
    description: 'Human contact person at the supplier',
    maxLength: 100,
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contact_person?: string;

  @ApiPropertyOptional({
    example: '0771234567',
    description: 'Sri Lankan phone number in format 0XXXXXXXXX',
  })
  @Transform(trimStringField)
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
  @Transform(trimStringField)
  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    example: 'No 45, Galle Road, Colombo 03',
    description: 'Free-form supplier address',
  })
  @Transform(trimStringField)
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    example: 'Payment on delivery, 30-day terms',
    description: 'Internal notes about the supplier',
  })
  @Transform(trimStringField)
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
