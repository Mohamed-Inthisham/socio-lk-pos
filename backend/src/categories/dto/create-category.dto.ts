import { TrackingMethod } from '../../products/enums/tracking-method.enum';
import {
  IsString,
  IsEnum,
  MaxLength,
  MinLength,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptionalNotNull } from '../../common/validators/is-optional-not-null.decorator';

export class CreateCategoryDto {
  @ApiProperty({
    example: 'Cables',
    description:
      'Category display name (case-insensitively unique within the same parent)',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: 'a3f2c8d0-1234-5678-9abc-def012345678',
    description:
      'Parent category UUID. Omit or send null for a top-level category. ' +
      'The parent itself must be top-level — categories cannot be nested more than two deep.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  parent_id?: string | null;

  @ApiPropertyOptional({
    example: 0,
    description:
      'Sort order (ascending). Defaults to 0. Ties broken alphabetically by name.',
    minimum: 0,
  })
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the category is active — defaults to true if omitted',
  })
  @IsOptionalNotNull()
  @IsBoolean()
  is_active?: boolean;
  @ApiPropertyOptional({
    description: 'Show phone specifications when adding or editing products.',
    default: false,
  })
  @IsOptionalNotNull()
  @IsBoolean()
  show_phone_specs?: boolean;

  @ApiPropertyOptional({
    enum: TrackingMethod,
    description:
      'Default for new products; existing products keep their tracking method.',
  })
  @IsOptionalNotNull()
  @IsEnum(TrackingMethod)
  default_tracking_method?: TrackingMethod;
}
