import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockModule } from '../stock/stock.module';
import { StockPurchaseItem } from './entities/stock-purchase-item.entity';
import { StockPurchasePayment } from './entities/stock-purchase-payment.entity';
import { StockPurchase } from './entities/stock-purchase.entity';
import { StockPurchasesController } from './stock-purchases.controller';
import { StockPurchasesService } from './stock-purchases.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([StockPurchase, StockPurchaseItem, StockPurchasePayment]),
    StockModule,
  ],
  controllers: [StockPurchasesController],
  providers: [StockPurchasesService],
  exports: [StockPurchasesService],
})
export class StockPurchasesModule {}
