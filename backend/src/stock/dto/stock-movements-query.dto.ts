import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  StockMovementReferenceType,
  StockMovementType,
} from '../enums/stock-movement-type.enum';

/** Filters for the read-only stock movement history endpoint. */
export class StockMovementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Admins may choose any branch; managers are limited to their assigned branch.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: StockMovementType })
  @IsOptional()
  @IsEnum(StockMovementType)
  movementType?: StockMovementType;

  @ApiPropertyOptional({ enum: StockMovementReferenceType })
  @IsOptional()
  @IsEnum(StockMovementReferenceType)
  referenceType?: StockMovementReferenceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by the user who performed the movement.',
  })
  @IsOptional()
  @IsUUID()
  performedBy?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Inclusive Colombo calendar date (YYYY-MM-DD).',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-11-18',
    description: 'Inclusive Colombo calendar date (YYYY-MM-DD).',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endDate?: string;
}
