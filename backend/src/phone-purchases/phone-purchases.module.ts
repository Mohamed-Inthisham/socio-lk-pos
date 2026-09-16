import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhonePurchase } from './entities/phone-purchase.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PhonePurchase])],
  exports: [TypeOrmModule],
})
export class PhonePurchasesModule {}
