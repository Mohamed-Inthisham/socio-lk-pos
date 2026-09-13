import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductUnit } from './entities/product-unit.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProductUnit])],
  exports: [TypeOrmModule],
})
export class ProductUnitsModule {}
