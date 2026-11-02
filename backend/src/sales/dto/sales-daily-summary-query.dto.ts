import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

export class SalesDailySummaryQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Staff: their own branch when left out; admins must give it (Phase 2 P2-1)',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({ example: '2026-10-01', description: 'Inclusive start of the Colombo date range' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-10-25', description: 'Inclusive end of the Colombo date range' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}
