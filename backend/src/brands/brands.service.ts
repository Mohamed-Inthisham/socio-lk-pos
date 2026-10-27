import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from './entities/brand.entity';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { CategoriesService } from '../categories/categories.service';

@Injectable()
export class BrandsService {
  constructor(
    @InjectRepository(Brand)
    private readonly brandsRepository: Repository<Brand>,
    private readonly categoriesService: CategoriesService,
  ) {}

  /**
   * Create a new brand.
   * Enforces case-insensitive uniqueness on name (also enforced at DB level
   * via a partial unique index on LOWER(name) WHERE deleted_at IS NULL).
   */
  async create(dto: CreateBrandDto): Promise<Brand> {
    const name = dto.name.trim();
    await this.assertNameNotTaken(name);

    if (dto.category_id) await this.assertCategoryActive(dto.category_id);

    const brand = this.brandsRepository.create({
      name,
      category_id: dto.category_id ?? null,
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
      relations: ['category'],
      order: { name: 'ASC' },
    });
  }

  /**
   * Find one brand by id. Throws NotFoundException if missing.
   * Returns inactive brands too — the admin editor needs to load them.
   */
  async findOne(id: string): Promise<Brand> {
    const brand = await this.brandsRepository.findOne({
      where: { id },
      relations: ['category'],
    });
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

    if (dto.category_id !== undefined && dto.category_id !== brand.category_id) {
      if (dto.category_id !== null) await this.assertCategoryActive(dto.category_id);
      const rows: { hasMismatch: boolean }[] = await this.brandsRepository.manager.query(
        `SELECT EXISTS (SELECT 1 FROM products WHERE brand_id = $1 AND category_id IS DISTINCT FROM $2::uuid) AS "hasMismatch"`,
        [id, dto.category_id],
      );
      if (rows[0]?.hasMismatch) {
        throw new BadRequestException('This brand is already used by products in another category.');
      }
      brand.category_id = dto.category_id;
    }

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

  private async assertCategoryActive(categoryId: string): Promise<void> {
    const category = await this.categoriesService.findOne(categoryId).catch(() => null);
    if (!category) throw new BadRequestException(`Category ${categoryId} not found`);
    if (!category.is_active) throw new BadRequestException(`Category "${category.name}" is not active`);
  }
}
