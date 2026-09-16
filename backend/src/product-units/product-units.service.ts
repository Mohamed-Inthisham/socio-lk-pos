import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductUnit } from './entities/product-unit.entity';
import { ListProductUnitsQueryDto } from './dto/list-product-units-query.dto';
import {
  paginate,
  PaginatedResponse,
} from '../common/dto/paginated-response.dto';

/**
 * Relations eagerly hydrated on findOne / findAll. Includes the parent
 * Product, Branch, and PhonePurchase (with its customer, so admins can
 * see who we bought the phone from without a second lookup).
 */
const PRODUCT_UNIT_RELATIONS = [
  'product',
  'branch',
  'phone_purchase',
  'phone_purchase.customer',
] as const;

@Injectable()
export class ProductUnitsService {
  constructor(
    @InjectRepository(ProductUnit)
    private readonly productUnitsRepository: Repository<ProductUnit>,
  ) {}

  /**
   * Paginated list of ProductUnits with optional filters.
   * Admin/Manager only per Q6 decision — cashiers interact with
   * ProductUnits implicitly via IMEI at ring-up (Slice E), not
   * through browse.
   *
   * Sorted by created_at DESC (newest first).
   */
  async findAll(
    query: ListProductUnitsQueryDto,
  ): Promise<PaginatedResponse<ProductUnit>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.productUnitsRepository
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.product', 'product')
      .leftJoinAndSelect('unit.branch', 'branch')
      .leftJoinAndSelect('unit.phone_purchase', 'phone_purchase')
      .leftJoinAndSelect('phone_purchase.customer', 'customer');

    if (query.productId) {
      qb.andWhere('unit.product_id = :productId', {
        productId: query.productId,
      });
    }
    if (query.branchId) {
      qb.andWhere('unit.branch_id = :branchId', {
        branchId: query.branchId,
      });
    }
    if (query.status) {
      qb.andWhere('unit.status = :status', { status: query.status });
    }
    if (query.imei) {
      qb.andWhere('unit.imei = :imei', { imei: query.imei });
    }

    qb.orderBy('unit.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, page, limit);
  }

  /**
   * Get one ProductUnit by ID with all relations hydrated.
   * NotFound if the ID doesn't exist.
   */
  async findOne(id: string): Promise<ProductUnit> {
    const unit = await this.productUnitsRepository.findOne({
      where: { id },
      relations: [...PRODUCT_UNIT_RELATIONS],
    });
    if (!unit) {
      throw new NotFoundException('Product unit not found');
    }
    return unit;
  }
}
