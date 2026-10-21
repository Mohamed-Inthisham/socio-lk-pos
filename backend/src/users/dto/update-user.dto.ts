import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

// skipNullProperties: false — null on email / full_name is a 400, not a
// 500; branch_id keeps its own @IsOptional, so null still clears it.
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'role'] as const),
  { skipNullProperties: false },
) {}
