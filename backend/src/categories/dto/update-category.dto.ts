import { PartialType } from '@nestjs/swagger';
import { CreateCategoryDto } from './create-category.dto';

// skipNullProperties: false — null on a NOT NULL field is a 400, not a
// 500 (the field's own validators run; optional NOT NULL fields carry
// @IsOptionalNotNull). Nullable fields keep @IsOptional: null clears them.
export class UpdateCategoryDto extends PartialType(CreateCategoryDto, {
  skipNullProperties: false,
}) {}
