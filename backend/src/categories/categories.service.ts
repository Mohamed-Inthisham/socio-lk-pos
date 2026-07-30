import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  /**
   * Create a new category. Enforces:
   *  - Two-level hierarchy (parent must be top-level).
   *  - Case-insensitive uniqueness scoped to siblings (also enforced by DB
   *    partial unique index).
   */
  async create(dto: CreateCategoryDto): Promise<Category> {
    const name = dto.name.trim();
    const parent_id = dto.parent_id ?? null;

    if (parent_id) {
      await this.assertParentIsTopLevel(parent_id);
    }
    await this.assertNameNotTakenAmongSiblings(name, parent_id);

    const category = this.categoriesRepository.create({
      name,
      parent_id,
      sort_order: dto.sort_order,
      is_active: dto.is_active,
    });
    return this.categoriesRepository.save(category);
  }

  /**
   * List categories. Returns a flat list — the frontend groups them by
   * parent_id for the two-level tree display. Sorted by sort_order ASC,
   * then name ASC for consistent display order.
   */
  async findAll(includeInactive = false): Promise<Category[]> {
    return this.categoriesRepository.find({
      where: includeInactive ? {} : { is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  /**
   * List only top-level categories. Useful for the parent picker in the
   * "create category" UI — where you only want to show valid parent choices.
   */
  async findTopLevel(includeInactive = false): Promise<Category[]> {
    return this.categoriesRepository.find({
      where: includeInactive
        ? { parent_id: IsNull() }
        : { parent_id: IsNull(), is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Find one category by id. Includes inactive rows so the admin editor
   * can load them.
   */
  async findOne(id: string): Promise<Category> {
    const category = await this.categoriesRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  /**
   * Partial update. Enforces:
   *  - Two-level rule: if parent_id changes, the new parent must be
   *    top-level, AND this category cannot itself have children (can't
   *    demote a parent to become a child, that would produce three levels).
   *  - Case-insensitive uniqueness among new siblings if the name changes
   *    or parent changes.
   *  - Cannot set parent_id to self (cycle prevention).
   */
  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.findOne(id);

    const newName = dto.name !== undefined ? dto.name.trim() : category.name;
    const newParentId =
      dto.parent_id !== undefined
        ? (dto.parent_id ?? null)
        : category.parent_id;

    if (newParentId === id) {
      throw new BadRequestException('A category cannot be its own parent');
    }

    if (newParentId !== category.parent_id && newParentId !== null) {
      await this.assertParentIsTopLevel(newParentId);
      await this.assertHasNoChildren(id);
    }

    // Only re-check uniqueness if name or parent actually changed
    const nameChanged = newName.toLowerCase() !== category.name.toLowerCase();
    const parentChanged = newParentId !== category.parent_id;
    if (nameChanged || parentChanged) {
      await this.assertNameNotTakenAmongSiblings(newName, newParentId, id);
    }

    category.name = newName;
    category.parent_id = newParentId;
    if (dto.sort_order !== undefined) category.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) category.is_active = dto.is_active;

    return this.categoriesRepository.save(category);
  }

  /**
   * Deactivate. Does not touch children (independent lifecycle).
   */
  async deactivate(id: string): Promise<Category> {
    const category = await this.findOne(id);
    if (!category.is_active) return category;
    category.is_active = false;
    return this.categoriesRepository.save(category);
  }

  /**
   * Reactivate. Idempotent.
   */
  async reactivate(id: string): Promise<Category> {
    const category = await this.findOne(id);
    if (category.is_active) return category;
    category.is_active = true;
    return this.categoriesRepository.save(category);
  }

  // ---- private guards ----

  /**
   * Loads the parent and rejects if it already has a parent of its own.
   * Two-level rule: a child cannot become a grandchild.
   */
  private async assertParentIsTopLevel(parentId: string): Promise<void> {
    const parent = await this.categoriesRepository.findOne({
      where: { id: parentId },
    });
    if (!parent) {
      throw new BadRequestException('Parent category not found');
    }
    if (parent.parent_id !== null) {
      throw new BadRequestException(
        'Categories can only be nested two levels deep. The chosen parent is already a child category.',
      );
    }
  }

  /**
   * Rejects if the given category id has any children. Called before
   * demoting a top-level category to become a child (which would put its
   * own children at three levels deep).
   */
  private async assertHasNoChildren(categoryId: string): Promise<void> {
    const childCount = await this.categoriesRepository.count({
      where: { parent_id: categoryId },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        'Cannot make this category a child — it already has sub-categories of its own. ' +
          'Move or delete its children first.',
      );
    }
  }

  /**
   * Case-insensitive uniqueness check among siblings under the same parent.
   * Excludes the row being updated (excludeId), so renaming a category to
   * its current name doesn't false-positive.
   *
   * Uses a query builder because the check involves LOWER() and a nullable
   * parent_id — both awkward to express through findOne's `where` clause.
   */
  private async assertNameNotTakenAmongSiblings(
    name: string,
    parent_id: string | null,
    excludeId?: string,
  ): Promise<void> {
    const qb = this.categoriesRepository
      .createQueryBuilder('category')
      .where('LOWER(category.name) = LOWER(:name)', { name });

    if (parent_id === null) {
      qb.andWhere('category.parent_id IS NULL');
    } else {
      qb.andWhere('category.parent_id = :parent_id', { parent_id });
    }

    if (excludeId) {
      qb.andWhere('category.id != :excludeId', { excludeId });
    }

    const existing = await qb.getOne();
    if (existing) {
      throw new ConflictException(
        `Category "${name}" already exists at this level`,
      );
    }
  }
}
