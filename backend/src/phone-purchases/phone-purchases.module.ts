import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhonePurchase } from './entities/phone-purchase.entity';
import { PhonePurchasesService } from './phone-purchases.service';
import { PhonePurchasesController } from './phone-purchases.controller';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [TypeOrmModule.forFeature([PhonePurchase]), StockModule],
  controllers: [PhonePurchasesController],
  providers: [PhonePurchasesService],
  exports: [TypeOrmModule, PhonePurchasesService],
})
export class PhonePurchasesModule {}
