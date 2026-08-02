import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { Branch } from '../branches/entities/branch.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { TypedConfigService } from '../config/typed-config.service';

@Injectable()
export class UsersService {
  private readonly bcryptRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Branch)
    private readonly branchesRepository: Repository<Branch>,
    config: TypedConfigService,
  ) {
    this.bcryptRounds = config.get('BCRYPT_ROUNDS');
  }

  /**
   * Find a user by email — INCLUDES password_hash.
   * Used by AuthService during login. Do not expose externally.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  /**
   * Find a user by id — INCLUDES password_hash.
   * Used internally by AuthService for token generation flows.
   * Do not expose externally.
   */
  async findByIdWithHash(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  /**
   * Find a user by id — EXCLUDES password_hash.
   * Safe to return to clients. Includes nested branch (may be null for admins).
   */
  async findById(id: string): Promise<Omit<User, 'password_hash'> | null> {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: { branch: true },
    });
    if (!user) return null;
    const { password_hash: _password_hash, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Create a new user. Hashes password, enforces email uniqueness,
   * enforces the branch/role invariant (admin: no branch; staff: required).
   */
  async create(dto: CreateUserDto): Promise<Omit<User, 'password_hash'>> {
    const normalizedEmail = dto.email.toLowerCase();

    const existing = await this.usersRepository.findOne({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    // Resolve effective role: DTO omits → entity default (CASHIER).
    const effectiveRole = dto.role ?? UserRole.CASHIER;

    // Enforce branch/role invariant BEFORE hashing the password —
    // no point burning bcrypt CPU on a payload we're about to reject.
    const resolvedBranchId = await this.resolveBranchForRole(
      effectiveRole,
      dto.branch_id,
    );

    const password_hash = await bcrypt.hash(dto.password, this.bcryptRounds);

    const user = this.usersRepository.create({
      email: normalizedEmail,
      password_hash,
      full_name: dto.full_name,
      role: dto.role, // undefined → entity default ('cashier')
      branch_id: resolvedBranchId,
    });

    const saved = await this.usersRepository.save(user);
    const { password_hash: _password_hash, ...safeUser } = saved;
    return safeUser;
  }

  /**
   * Partial update. Password changes go through a separate flow.
   * Role is IMMUTABLE post-creation (enforced at both DTO and service layers).
   * Branch transfers are allowed for staff; admins cannot be given a branch.
   */
  async update(
    id: string,
    dto: UpdateUserDto,
  ): Promise<Omit<User, 'password_hash'>> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.email) {
      const normalized = dto.email.toLowerCase();
      if (normalized !== user.email) {
        const clash = await this.usersRepository.findOne({
          where: { email: normalized },
        });
        if (clash) {
          throw new ConflictException('Email is already registered');
        }
        user.email = normalized;
      }
    }
    if (dto.full_name !== undefined) user.full_name = dto.full_name;

    if (dto.branch_id !== undefined) {
      if (user.role === UserRole.ADMIN) {
        throw new BadRequestException(
          'Admin users cannot be assigned to a branch',
        );
      }
      await this.assertActiveBranch(dto.branch_id);
      user.branch_id = dto.branch_id;
    }

    const saved = await this.usersRepository.save(user);
    const { password_hash: _password_hash, ...safeUser } = saved;
    return safeUser;
  }

  /**
   * Deactivate a user — they keep existing but cannot log in.
   * This is the everyday "remove user" operation in a POS.
   */
  async deactivate(id: string): Promise<void> {
    const result = await this.usersRepository.update(id, { is_active: false });
    if (result.affected === 0) {
      throw new NotFoundException('User not found');
    }
  }

  /**
   * Soft-delete — sets deleted_at. Subsequent queries exclude this user.
   * Use sparingly; prefer deactivate() for normal POS user lifecycle.
   */
  async softDelete(id: string): Promise<void> {
    const result = await this.usersRepository.softDelete(id);
    if (result.affected === 0) {
      throw new NotFoundException('User not found');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Enforce the User ↔ Branch invariant on creation:
   *   - admin        → branch_id MUST be absent
   *   - manager/cashier → branch_id MUST be present AND point to an active branch
   * Returns the resolved branch_id (null for admin, UUID for staff).
   *
   * This mirrors the DB-level CHK_users_branch_role constraint but produces
   * a clean 400 with a helpful message instead of a raw Postgres error.
   */
  private async resolveBranchForRole(
    role: UserRole,
    providedBranchId: string | undefined,
  ): Promise<string | null> {
    if (role === UserRole.ADMIN) {
      if (providedBranchId !== undefined) {
        throw new BadRequestException(
          'Admin users cannot be assigned to a branch',
        );
      }
      return null;
    }

    if (!providedBranchId) {
      throw new BadRequestException(
        `${role} users must be assigned to a branch (branch_id is required)`,
      );
    }

    await this.assertActiveBranch(providedBranchId);
    return providedBranchId;
  }

  /**
   * Confirms a branch exists AND is currently active. Produces a clean 400
   * instead of letting Postgres throw an FK error at insert time.
   */
  private async assertActiveBranch(branchId: string): Promise<void> {
    const branch = await this.branchesRepository.findOne({
      where: { id: branchId },
    });
    if (!branch) {
      throw new BadRequestException(`Branch ${branchId} does not exist`);
    }
    if (!branch.is_active) {
      throw new BadRequestException(`Branch "${branch.name}" is not active`);
    }
  }
}
