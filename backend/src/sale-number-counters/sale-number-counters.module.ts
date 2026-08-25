import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleNumberCounter } from './entities/sale-number-counter.entity';
import { SaleNumberCountersService } from './sale-number-counters.service';

@Module({
  imports: [TypeOrmModule.forFeature([SaleNumberCounter])],
  providers: [SaleNumberCountersService],
  exports: [SaleNumberCountersService],
})
export class SaleNumberCountersModule {}
