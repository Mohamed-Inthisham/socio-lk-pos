import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { Branch } from '../branches/entities/branch.entity';
import { TypedConfigService } from '../config/typed-config.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

describe('UsersService', () => {
  let service: UsersService;

  const mockUsersRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };

  const mockBranchesRepo = {
    findOne: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string) => (key === 'BCRYPT_ROUNDS' ? 4 : undefined)),
  };

  const activeBranch: Branch = {
    id: 'branch-1',
    name: 'Main Shop',
    address: null,
    phone: null,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const inactiveBranch: Branch = {
    ...activeBranch,
    id: 'branch-2',
    name: 'Old Shop',
    is_active: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        { provide: getRepositoryToken(Branch), useValue: mockBranchesRepo },
        { provide: TypedConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByEmail', () => {
    it('normalizes email to lowercase before lookup', async () => {
      mockUsersRepo.findOne.mockResolvedValue(null);
      await service.findByEmail('User@Test.COM');
      expect(mockUsersRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'user@test.com' },
      });
    });

    it('returns the user when found', async () => {
      const user = { id: 'u1', email: 'a@b.com' } as User;
      mockUsersRepo.findOne.mockResolvedValue(user);
      const result = await service.findByEmail('a@b.com');
      expect(result).toBe(user);
    });

    it('returns null when not found', async () => {
      mockUsersRepo.findOne.mockResolvedValue(null);
      const result = await service.findByEmail('nobody@t.com');
      expect(result).toBeNull();
    });
  });

  describe('findByIdWithHash', () => {
    it('returns the user by id (including password_hash)', async () => {
      const user = { id: 'u1', password_hash: 'x' } as User;
      mockUsersRepo.findOne.mockResolvedValue(user);
      const result = await service.findByIdWithHash('u1');
      expect(mockUsersRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'u1' },
      });
      expect(result).toBe(user);
    });
  });

  describe('findById', () => {
    it('loads the branch relation', async () => {
      mockUsersRepo.findOne.mockResolvedValue(null);
      await service.findById('u1');
      expect(mockUsersRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'u1' },
        relations: { branch: true },
      });
    });

    it('strips password_hash from the returned user', async () => {
      const user = {
        id: 'u1',
        email: 'a@b.com',
        password_hash: 'secret',
        role: UserRole.CASHIER,
        branch_id: 'branch-1',
        branch: activeBranch,
      } as User;
      mockUsersRepo.findOne.mockResolvedValue(user);

      const result = await service.findById('u1');
      expect(result).toBeDefined();
      expect((result as unknown as User).password_hash).toBeUndefined();
      expect(result!.id).toBe('u1');
    });

    it('returns null when not found', async () => {
      mockUsersRepo.findOne.mockResolvedValue(null);
      const result = await service.findById('missing');
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mockUsersRepo.findOne.mockResolvedValue(null);
      mockUsersRepo.save.mockImplementation((u) =>
        Promise.resolve({ ...u, id: 'new-user' }),
      );
      mockUsersRepo.create.mockImplementation((u) => u);
    });

    it('creates an admin user without a branch', async () => {
      const result = await service.create({
        email: 'admin@t.com',
        password: 'pw12345678',
        full_name: 'Admin',
        role: UserRole.ADMIN,
      });

      expect(mockBranchesRepo.findOne).not.toHaveBeenCalled();
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'admin@t.com',
          role: UserRole.ADMIN,
          branch_id: null,
        }),
      );
      expect((result as unknown as User).password_hash).toBeUndefined();
    });

    it('rejects admin with branch_id (400)', async () => {
      await expect(
        service.create({
          email: 'admin@t.com',
          password: 'pw12345678',
          full_name: 'Admin',
          role: UserRole.ADMIN,
          branch_id: 'branch-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a cashier with an active branch', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(activeBranch);
      await service.create({
        email: 'c@t.com',
        password: 'pw12345678',
        full_name: 'Cashier',
        role: UserRole.CASHIER,
        branch_id: 'branch-1',
      });
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.CASHIER,
          branch_id: 'branch-1',
        }),
      );
    });

    it('creates a manager with an active branch', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(activeBranch);
      await service.create({
        email: 'm@t.com',
        password: 'pw12345678',
        full_name: 'Manager',
        role: UserRole.MANAGER,
        branch_id: 'branch-1',
      });
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.MANAGER,
          branch_id: 'branch-1',
        }),
      );
    });

    it('defaults role to CASHIER when omitted → still requires branch_id', async () => {
      await expect(
        service.create({
          email: 'x@t.com',
          password: 'pw12345678',
          full_name: 'X',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cashier without branch_id (400)', async () => {
      await expect(
        service.create({
          email: 'c@t.com',
          password: 'pw12345678',
          full_name: 'Cashier',
          role: UserRole.CASHIER,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects manager without branch_id (400)', async () => {
      await expect(
        service.create({
          email: 'm@t.com',
          password: 'pw12345678',
          full_name: 'Manager',
          role: UserRole.MANAGER,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects staff with a nonexistent branch_id (400)', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create({
          email: 'c@t.com',
          password: 'pw12345678',
          full_name: 'Cashier',
          role: UserRole.CASHIER,
          branch_id: 'ghost',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects staff with an inactive branch_id (400)', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(inactiveBranch);
      await expect(
        service.create({
          email: 'c@t.com',
          password: 'pw12345678',
          full_name: 'Cashier',
          role: UserRole.CASHIER,
          branch_id: 'branch-2',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate email with ConflictException (409)', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({
          email: 'exists@t.com',
          password: 'pw12345678',
          full_name: 'Dup',
          role: UserRole.ADMIN,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('normalizes email to lowercase before insert', async () => {
      await service.create({
        email: 'Admin@Test.COM',
        password: 'pw12345678',
        full_name: 'A',
        role: UserRole.ADMIN,
      });
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'admin@test.com' }),
      );
    });
  });

  describe('update', () => {
    const cashier = {
      id: 'u1',
      email: 'c@t.com',
      role: UserRole.CASHIER,
      branch_id: 'branch-1',
      full_name: 'Cashier',
      password_hash: 'x',
    } as User;

    const admin = {
      id: 'u2',
      email: 'a@t.com',
      role: UserRole.ADMIN,
      branch_id: null,
      full_name: 'Admin',
      password_hash: 'x',
    } as User;

    it('throws NotFoundException when user does not exist', async () => {
      mockUsersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', { full_name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates full_name', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ ...cashier });
      mockUsersRepo.save.mockImplementation((u) => Promise.resolve(u));
      const result = await service.update('u1', { full_name: 'New Name' });
      expect(result.full_name).toBe('New Name');
    });

    it('updates email with lowercasing', async () => {
      mockUsersRepo.findOne
        .mockResolvedValueOnce({ ...cashier })
        .mockResolvedValueOnce(null);
      mockUsersRepo.save.mockImplementation((u) => Promise.resolve(u));
      const result = await service.update('u1', { email: 'New@T.COM' });
      expect(result.email).toBe('new@t.com');
    });

    it('rejects email change that clashes (409)', async () => {
      mockUsersRepo.findOne
        .mockResolvedValueOnce({ ...cashier })
        .mockResolvedValueOnce({ id: 'other' });
      await expect(
        service.update('u1', { email: 'clash@t.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('transfers a cashier to a different active branch', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ ...cashier });
      mockBranchesRepo.findOne.mockResolvedValue({
        ...activeBranch,
        id: 'branch-new',
        name: 'Kandy Shop',
      });
      mockUsersRepo.save.mockImplementation((u) => Promise.resolve(u));

      const result = await service.update('u1', { branch_id: 'branch-new' });
      expect(result.branch_id).toBe('branch-new');
    });

    it('rejects setting branch_id on an admin (400)', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ ...admin });
      await expect(
        service.update('u2', { branch_id: 'branch-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transferring staff to an inactive branch (400)', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ ...cashier });
      mockBranchesRepo.findOne.mockResolvedValue(inactiveBranch);
      await expect(
        service.update('u1', { branch_id: 'branch-2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transferring staff to a nonexistent branch (400)', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ ...cashier });
      mockBranchesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('u1', { branch_id: 'ghost' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deactivate', () => {
    it('flips is_active to false', async () => {
      mockUsersRepo.update.mockResolvedValue({ affected: 1 });
      await service.deactivate('u1');
      expect(mockUsersRepo.update).toHaveBeenCalledWith('u1', {
        is_active: false,
      });
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockUsersRepo.update.mockResolvedValue({ affected: 0 });
      await expect(service.deactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('softDelete', () => {
    it('soft-deletes the user', async () => {
      mockUsersRepo.softDelete.mockResolvedValue({ affected: 1 });
      await service.softDelete('u1');
      expect(mockUsersRepo.softDelete).toHaveBeenCalledWith('u1');
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockUsersRepo.softDelete.mockResolvedValue({ affected: 0 });
      await expect(service.softDelete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
