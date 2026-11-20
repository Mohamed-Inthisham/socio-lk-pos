import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import {
  StockMovementReferenceType,
  StockMovementType,
} from '../enums/stock-movement-type.enum';
import { ProductUnitStatus } from '../../product-units/enums/product-unit-status.enum';

/** Minimal, explicitly mapped user details safe for movement history. */
export class StockMovementActorDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  full_name!: string;
}

/** Explicit API shape: deliberately contains no prices or source relations. */
export class StockMovementHistoryRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() movement_type!: StockMovementType;
  @ApiProperty() product_id!: string;
  @ApiProperty() product_name!: string;
  @ApiProperty() branch_id!: string;
  @ApiProperty() branch_name!: string;
  @ApiPropertyOptional({ nullable: true }) product_unit_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) product_unit_code!: string | null;
  @ApiProperty() quantity_delta!: number;
  @ApiProperty() quantity_before!: number;
  @ApiProperty() quantity_after!: number;
  @ApiProperty() stock_managed!: boolean;
  @ApiPropertyOptional({ enum: ProductUnitStatus, nullable: true })
  unit_status_from!: ProductUnitStatus | null;
  @ApiPropertyOptional({ enum: ProductUnitStatus, nullable: true })
  unit_status_to!: ProductUnitStatus | null;
  @ApiPropertyOptional({ nullable: true }) reason_code!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() reference_type!: StockMovementReferenceType;
  @ApiProperty() reference_id!: string;
  @ApiPropertyOptional({ nullable: true }) reverses_movement_id!: string | null;
  @ApiPropertyOptional({ type: StockMovementActorDto, nullable: true })
  performed_by!: StockMovementActorDto | null;
  @ApiPropertyOptional({ type: StockMovementActorDto, nullable: true })
  approved_by!: StockMovementActorDto | null;
  @ApiProperty() created_at!: Date;
}

export class StockMovementHistoryResponseDto {
  @ApiProperty({ type: [StockMovementHistoryRowDto] })
  data!: StockMovementHistoryRowDto[];

  @ApiProperty({ type: PaginationMeta })
  meta!: PaginationMeta;
}
