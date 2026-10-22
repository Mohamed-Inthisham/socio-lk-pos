import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';

/**
 * Manager approval PIN (Phase 6.4 P6-15 – P6-21). Exports ApprovalsService
 * for every action that needs a manager's approval: SalesModule (void)
 * now, returns in P7.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
