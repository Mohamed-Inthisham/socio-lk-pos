import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { BarcodeLabelsController } from './barcode-labels.controller';
import { BarcodeLabelsService } from './barcode-labels.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductUnit])],
  controllers: [BarcodeLabelsController],
  providers: [BarcodeLabelsService],
})
export class BarcodeLabelsModule {}
