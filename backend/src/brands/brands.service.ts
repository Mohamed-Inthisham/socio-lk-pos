import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from './entities/brand.entity';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(
    @InjectRepository(Brand)
    private readonly brandsRepository: Repository<Brand>,
  ) {}

  /**
   * Create a new brand.
   * Enforces case-insensitive uniqueness on name (also enforced at DB level
   * via a partial unique index on LOWER(name) WHERE deleted_at IS NULL).
   */
  async create(dto: CreateBrandDto): Promise<Brand> {
    const name = dto.name.trim();
    await this.assertNameNotTaken(name);

    const brand = this.brandsRepository.create({
      name,
      is_active: dto.is_active,
    });
    return this.brandsRepository.save(brand);
  }

  /**
   * List brands. By default returns only active brands.
   * Soft-deleted brands are always excluded (TypeORM handles this via
   * @DeleteDateColumn).
   */
  async findAll(includeInactive = false): Promise<Brand[]> {
    return this.brandsRepository.find({
      where: includeInactive ? {} : { is_active: true },
      order: { name: 'ASC' },
    });
  }

  /**
   * Find one brand by id. Throws NotFoundException if missing.
   * Returns inactive brands too — the admin editor needs to load them.
   */
  async findOne(id: string): Promise<Brand> {
    const brand = await this.brandsRepository.findOne({ where: { id } });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return brand;
  }

  /**
   * Partial update. Enforces case-insensitive name uniqueness if name changes.
   */
  async update(id: string, dto: UpdateBrandDto): Promise<Brand> {
    const brand = await this.findOne(id);

    if (dto.name !== undefined) {
      const newName = dto.name.trim();
      if (newName.toLowerCase() !== brand.name.toLowerCase()) {
        await this.assertNameNotTaken(newName);
      }
      brand.name = newName;
    }
    if (dto.is_active !== undefined) brand.is_active = dto.is_active;

    return this.brandsRepository.save(brand);
  }

  /**
   * "Delete" a brand — deactivates it. Same pattern as Branch: mutations that
   * would orphan history are avoided. Idempotent.
   */
  async deactivate(id: string): Promise<Brand> {
    const brand = await this.findOne(id);
    if (!brand.is_active) return brand;
    brand.is_active = false;
    return this.brandsRepository.save(brand);
  }

  /**
   * Reactivate a deactivated brand. Idempotent.
   */
  async reactivate(id: string): Promise<Brand> {
    const brand = await this.findOne(id);
    if (brand.is_active) return brand;
    brand.is_active = true;
    return this.brandsRepository.save(brand);
  }

  /**
   * Case-insensitive name conflict check. Application-level guard that
   * matches the DB partial unique index — catches conflicts before the
   * repository call and returns a clean 409 instead of a generic 500.
   */
  private async assertNameNotTaken(name: string): Promise<void> {
    const existing = await this.brandsRepository
      .createQueryBuilder('brand')
      .where('LOWER(brand.name) = LOWER(:name)', { name })
      .getOne();
    if (existing) {
      throw new ConflictException(`Brand "${name}" already exists`);
    }
  }
}
