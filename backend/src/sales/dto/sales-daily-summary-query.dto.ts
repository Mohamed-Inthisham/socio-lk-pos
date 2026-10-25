import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

export class SalesDailySummaryQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: '2026-10-25', description: 'Colombo business date' })
  @IsDateString({ strict: true })
  date!: string;
}
