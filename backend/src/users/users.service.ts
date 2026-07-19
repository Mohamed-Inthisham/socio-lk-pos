import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

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
   * Safe to return to clients.
   */
  async findById(id: string): Promise<Omit<User, 'password_hash'> | null> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) return null;
    const { password_hash: _password_hash, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Create a new user. Hashes password, enforces email uniqueness.
   */
  async create(dto: CreateUserDto): Promise<Omit<User, 'password_hash'>> {
    const normalizedEmail = dto.email.toLowerCase();

    const existing = await this.usersRepository.findOne({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const password_hash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    const user = this.usersRepository.create({
      email: normalizedEmail,
      password_hash,
      full_name: dto.full_name,
      role: dto.role, // undefined → entity default ('cashier')
    });

    const saved = await this.usersRepository.save(user);
    const { password_hash: _password_hash, ...safeUser } = saved;
    return safeUser;
  }

  /**
   * Partial update. Password changes go through a separate flow.
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
    if (dto.role !== undefined) user.role = dto.role;

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
}
