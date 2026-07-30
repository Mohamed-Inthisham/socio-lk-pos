import {
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBrandDto {
  @ApiProperty({
    example: 'Apple',
    description: 'Brand display name (case-insensitively unique)',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the brand is active — defaults to true if omitted',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
