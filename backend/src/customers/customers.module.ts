import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './entities/customer.entity';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';

/**
 * Customers module — Phase 6.3.5 Slice A.
 *
 * Exports CustomersService so Slice D (PhonePurchase) and Slice G
 * (Trade-ins) can inject it for the customer resolve-or-create flow.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Customer])],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
