import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** GET /cash-days/current?branchId= (Phase 6.4 P9-7, P9-8). */
export class CurrentCashDayQueryDto {
  @ApiProperty({
    description: 'The branch. Managers and cashiers: their own; admins: any.',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'branchId must be a UUID' })
  branchId!: string;
}
