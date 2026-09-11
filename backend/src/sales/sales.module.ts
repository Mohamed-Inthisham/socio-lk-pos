import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sale } from './entities/sale.entity';
import { SaleLine } from './entities/sale-line.entity';
import { Payment } from './entities/payment.entity';
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { ProductsModule } from '../products/products.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { StockModule } from '../stock/stock.module';
import { SaleNumberCountersModule } from '../sale-number-counters/sale-number-counters.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sale, SaleLine, Payment, Branch, User]),
    ProductsModule,
    SuppliersModule,
    StockModule,
    SaleNumberCountersModule,
  ],
  providers: [SalesService],
  controllers: [SalesController],
  exports: [SalesService],
})
export class SalesModule {}
