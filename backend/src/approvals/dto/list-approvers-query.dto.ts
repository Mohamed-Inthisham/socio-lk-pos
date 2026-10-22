import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** GET /approvers?branchId= (Phase 6.4 P6-16). */
export class ListApproversQueryDto {
  @ApiProperty({
    description:
      "The sale's branch. Non-admins may ask only for their own branch.",
    format: 'uuid',
  })
  @IsUUID()
  branchId!: string;
}
