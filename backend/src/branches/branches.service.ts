import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from './entities/branch.entity';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch)
    private readonly branchesRepository: Repository<Branch>,
  ) {}

  /**
   * Create a new branch.
   * `is_active` defaults to true at entity level if omitted from the DTO.
   */
  async create(dto: CreateBranchDto): Promise<Branch> {
    const branch = this.branchesRepository.create({
      name: dto.name,
      address: dto.address ?? null,
      phone: dto.phone ?? null,
      is_active: dto.is_active,
    });
    return this.branchesRepository.save(branch);
  }

  /**
   * List branches. By default returns only active branches (cashier UX).
   * Pass includeInactive=true from the admin UI to show all.
   * Sorted by created_at ASC so "Main Shop" (seeded first) is always first.
   */
  async findAll(includeInactive = false): Promise<Branch[]> {
    return this.branchesRepository.find({
      where: includeInactive ? {} : { is_active: true },
      order: { created_at: 'ASC' },
    });
  }

  /**
   * Find one branch by id. Throws NotFoundException if missing.
   * Returns inactive branches too — the admin editor needs to load them.
   */
  async findOne(id: string): Promise<Branch> {
    const branch = await this.branchesRepository.findOne({ where: { id } });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  /**
   * Partial update. If is_active transitions true → false, applies the
   * "cannot deactivate the last active branch" guard.
   */
  async update(id: string, dto: UpdateBranchDto): Promise<Branch> {
    const branch = await this.findOne(id);

    // Guard: is_active true → false requires the deactivation invariant
    if (dto.is_active === false && branch.is_active === true) {
      await this.assertNotLastActiveBranch();
    }

    if (dto.name !== undefined) branch.name = dto.name;
    if (dto.address !== undefined) branch.address = dto.address ?? null;
    if (dto.phone !== undefined) branch.phone = dto.phone ?? null;
    if (dto.is_active !== undefined) branch.is_active = dto.is_active;

    return this.branchesRepository.save(branch);
  }

  /**
   * "Delete" a branch — actually deactivates it. Hard delete is deliberately
   * unsupported because branches are referenced by products, stock, sales,
   * and users; removing rows would orphan history.
   *
   * Guard: cannot deactivate the last active branch.
   */
  async deactivate(id: string): Promise<Branch> {
    const branch = await this.findOne(id);

    if (!branch.is_active) {
      // Already inactive — treat as no-op success rather than error.
      return branch;
    }

    await this.assertNotLastActiveBranch();

    branch.is_active = false;
    return this.branchesRepository.save(branch);
  }

  /**
   * Reactivate a previously deactivated branch.
   */
  async reactivate(id: string): Promise<Branch> {
    const branch = await this.findOne(id);
    if (branch.is_active) {
      // Already active — no-op.
      return branch;
    }
    branch.is_active = true;
    return this.branchesRepository.save(branch);
  }

  /**
   * Invariant: at least one branch must always be active.
   * Called before any is_active true → false transition.
   */
  private async assertNotLastActiveBranch(): Promise<void> {
    const activeCount = await this.branchesRepository.count({
      where: { is_active: true },
    });
    if (activeCount <= 1) {
      throw new BadRequestException(
        'Cannot deactivate the last active branch. At least one active branch must exist.',
      );
    }
  }
}
