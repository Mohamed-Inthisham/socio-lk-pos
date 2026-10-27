import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { StockPurchasePaymentStatus } from '../enums/stock-purchase-payment-status.enum';

export class UpdateStockPurchasePaymentStatusDto {
  @ApiProperty({ enum: [StockPurchasePaymentStatus.CLEARED, StockPurchasePaymentStatus.BOUNCED] })
  @IsIn([StockPurchasePaymentStatus.CLEARED, StockPurchasePaymentStatus.BOUNCED])
  status!: StockPurchasePaymentStatus.CLEARED | StockPurchasePaymentStatus.BOUNCED;
}
