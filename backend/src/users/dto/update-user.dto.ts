import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

// skipNullProperties: false — null on email / full_name / branch_id is a
// 400, not a 500 (no user's branch can be cleared: admins never have one,
// staff must keep one).
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'role'] as const),
  { skipNullProperties: false },
) {}
