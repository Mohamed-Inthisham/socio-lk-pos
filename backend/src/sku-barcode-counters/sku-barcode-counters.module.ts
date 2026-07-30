import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SkuBarcodeCounter } from './entities/sku-barcode-counter.entity';
import { SkuBarcodeCountersService } from './sku-barcode-counters.service';

@Module({
  imports: [TypeOrmModule.forFeature([SkuBarcodeCounter])],
  providers: [SkuBarcodeCountersService],
  controllers: [],
  exports: [SkuBarcodeCountersService],
})
export class SkuBarcodeCountersModule {}
