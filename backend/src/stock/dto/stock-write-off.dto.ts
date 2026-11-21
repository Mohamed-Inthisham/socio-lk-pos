import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export enum StockWriteOffReason {
  DAMAGED = 'DAMAGED',
  LOST = 'LOST',
  STOLEN = 'STOLEN',
  EXPIRED = 'EXPIRED',
  OBSOLETE = 'OBSOLETE',
  OTHER = 'OTHER',
}

export class StockWriteOffDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  client_request_id!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expected_quantity!: number;

  @ApiProperty({ enum: StockWriteOffReason })
  @IsEnum(StockWriteOffReason)
  reasonCode!: StockWriteOffReason;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class IdentifiedUnitWriteOffDto {
  @ApiProperty({ enum: StockWriteOffReason })
  @IsEnum(StockWriteOffReason)
  reasonCode!: StockWriteOffReason;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
