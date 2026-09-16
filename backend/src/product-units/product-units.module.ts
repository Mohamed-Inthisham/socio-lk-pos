import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductUnit } from './entities/product-unit.entity';
import { ProductUnitsService } from './product-units.service';
import { ProductUnitsController } from './product-units.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProductUnit])],
  controllers: [ProductUnitsController],
  providers: [ProductUnitsService],
  exports: [TypeOrmModule, ProductUnitsService],
})
export class ProductUnitsModule {}
