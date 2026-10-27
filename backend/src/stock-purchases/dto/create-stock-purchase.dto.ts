import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateStockPurchasePaymentDto } from './create-stock-purchase-payment.dto';

// Purchase prices are also copied to Product's numeric(10,2) price fields.
const moneyPattern = /^\d{1,8}(\.\d{1,2})?$/;

export class CreateStockPurchaseItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  product_id!: string;

  @ApiProperty({ minimum: 1, example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: '18000.00' })
  @IsString()
  @Matches(moneyPattern, { message: 'unit_buying_price must be a valid amount' })
  @IsNumberString({ no_symbols: false })
  unit_buying_price!: string;

  @ApiPropertyOptional({ example: '22000.00' })
  @IsOptional()
  @IsString()
  @Matches(moneyPattern, { message: 'unit_selling_price must be a valid amount' })
  unit_selling_price?: string;

  @ApiPropertyOptional({ type: [String], example: ['356938035643810'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(8, { each: true })
  @MaxLength(50, { each: true })
  @Matches(/^[A-Za-z0-9-]+$/, {
    each: true,
    message: 'IMEIs must contain letters, numbers, or hyphens',
  })
  imei_numbers?: string[];

  @ApiPropertyOptional({ type: [String], example: ['SN-87E56576754'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  @Matches(/^[A-Za-z0-9-]+$/, {
    each: true,
    message: 'Serial numbers must contain letters, numbers, or hyphens',
  })
  serial_numbers?: string[];
}

export class CreateStockPurchaseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supplier_id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branch_id!: string;

  @ApiPropertyOptional({ example: '2026-10-27' })
  @IsOptional()
  @IsDateString()
  purchase_date?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier_invoice_number?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: CreateStockPurchasePaymentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateStockPurchasePaymentDto)
  initial_payment?: CreateStockPurchasePaymentDto;

  @ApiProperty({ type: [CreateStockPurchaseItemDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateStockPurchaseItemDto)
  items!: CreateStockPurchaseItemDto[];
}
