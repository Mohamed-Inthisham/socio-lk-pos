import {
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  IsBoolean,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBranchDto {
  @ApiProperty({
    example: 'Main Shop',
    description: 'Branch display name',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: '123 Peradeniya Road, Kandy',
    description: 'Branch physical address (printed on receipts)',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    example: '0812223344',
    description:
      'Sri Lankan phone number: exactly 10 digits, must start with 0. No spaces, dashes, or country code.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^0\d{9}$/, {
    message:
      'Phone must be exactly 10 digits and start with 0 (e.g. 0771234567 or 0812223344)',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the branch is active — defaults to true if omitted',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
