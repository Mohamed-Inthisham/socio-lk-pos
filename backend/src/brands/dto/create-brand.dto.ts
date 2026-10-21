import { IsString, MaxLength, MinLength, IsBoolean } from 'class-validator';
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
    example: true,
    description: 'Whether the brand is active — defaults to true if omitted',
  })
  @IsOptionalNotNull()
  @IsBoolean()
  is_active?: boolean;
}
