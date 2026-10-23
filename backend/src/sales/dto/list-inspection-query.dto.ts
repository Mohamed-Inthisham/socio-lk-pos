import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** GET /sale-returns/inspection?branchId= (Phase 6.4 P7-33). */
export class ListInspectionQueryDto {
  @ApiProperty({
    description: 'The branch. Managers may ask only for their own branch.',
    format: 'uuid',
  })
  @IsUUID()
  branchId!: string;
}
