import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupplierReturn } from './entities/supplier-return.entity';
import { SupplierReturnLine } from './entities/supplier-return-line.entity';
import { SupplierReturnLineUnit } from './entities/supplier-return-line-unit.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupplierReturn,
      SupplierReturnLine,
      SupplierReturnLineUnit,
    ]),
  ],
})
export class SupplierReturnsModule {}
