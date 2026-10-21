import { PartialType } from '@nestjs/swagger';
import { CreateBranchDto } from './create-branch.dto';

// skipNullProperties: false — null on a NOT NULL field is a 400, not a
// 500 (the field's own validators run; optional NOT NULL fields carry
// @IsOptionalNotNull). Nullable fields keep @IsOptional: null clears them.
export class UpdateBranchDto extends PartialType(CreateBranchDto, {
  skipNullProperties: false,
}) {}
