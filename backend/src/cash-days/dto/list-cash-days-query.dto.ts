import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** GET /cash-days?branchId=&page=&limit= (Phase 6.4 P9-16). */
export class ListCashDaysQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'The branch. Managers and cashiers: their own; admins: any.',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'branchId must be a UUID' })
  branchId!: string;
}
