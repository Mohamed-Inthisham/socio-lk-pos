import { IsString, MaxLength, MinLength, IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptionalNotNull } from '../../common/validators/is-optional-not-null.decorator';

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
    description: 'Category this brand belongs to. New product forms use it to show relevant brands.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  category_id?: string | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the brand is active — defaults to true if omitted',
  })
  @IsOptionalNotNull()
  @IsBoolean()
  is_active?: boolean;
}
