import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stock } from './entities/stock.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';
import { ProductsModule } from '../products/products.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stock, StockMovement]),
    forwardRef(() => ProductsModule),
    BranchesModule,
  ],
  providers: [StockService],
  controllers: [StockController],
  exports: [StockService],
})
export class StockModule {}
