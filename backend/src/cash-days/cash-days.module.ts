import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashDay } from './entities/cash-day.entity';
import { CashDaysService } from './cash-days.service';
import { CashDaysController } from './cash-days.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CashDay])],
  providers: [CashDaysService],
  controllers: [CashDaysController],
  exports: [CashDaysService],
})
export class CashDaysModule {}
