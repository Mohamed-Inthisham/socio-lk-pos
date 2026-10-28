import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ParseUUIDPipe,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Sale } from '../entities/sale.entity';
import { UserRole } from '../../users/enums/user-role.enum';

/**
 * Runs after the global authentication/role guards and before handlers or
 * audit interceptors. Sale.branch_id cannot be changed by the mutation DTOs,
 * so this check leaves the existing transaction/lock boundaries intact.
 */
@Injectable()
export class SaleBranchGuard implements CanActivate {
  constructor(
    @InjectRepository(Sale) private readonly salesRepository: Repository<Sale>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    // Guards run before parameter pipes. Validate before querying PostgreSQL.
    const parentId = request.params.saleId ?? request.params.id;
    const id = await new ParseUUIDPipe().transform(
      typeof parentId === 'string' ? parentId : '',
      { type: 'param' },
    );
    const sale = await this.salesRepository.findOne({
      where: { id },
      select: { id: true, branch_id: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    if (user.role !== UserRole.ADMIN && user.branch_id !== sale.branch_id) {
      throw new ForbiddenException({
        message: 'You can only modify sales at your own branch.',
        code: 'SALE_WRONG_BRANCH',
      });
    }
    return true;
  }
}
