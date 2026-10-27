import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { StockPurchasePaymentMethod } from '../enums/stock-purchase-payment-method.enum';

const paymentAmountPattern = /^\d{1,12}(\.\d{1,2})?$/;

export class CreateStockPurchasePaymentDto {
  @ApiProperty({ example: '25000.00' })
  @IsString()
  @Matches(paymentAmountPattern)
  amount!: string;

  @ApiProperty({ enum: StockPurchasePaymentMethod })
  @IsEnum(StockPurchasePaymentMethod)
  method!: StockPurchasePaymentMethod;

  @ApiProperty({ format: 'date', example: '2026-10-27' })
  @IsDateString()
  payment_date!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 50, description: 'Required for cheque payments.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  cheque_number?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Required for cheque payments.' })
  @IsOptional()
  @IsDateString()
  cheque_date?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Required for cheque payments.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bank?: string;
}
