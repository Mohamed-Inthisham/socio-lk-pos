import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { UserRole } from './enums/user-role.enum';
import { Branch } from '../branches/entities/branch.entity';
import { TypedConfigService } from '../config/typed-config.service';
import * as bcrypt from 'bcrypt';
import { PASSWORD_TOO_LONG_MESSAGE } from '../common/bcrypt-input';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

describe('UsersService', () => {
  let service: UsersService;

  const mockQueryBuilder = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const mockUsersRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
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

  // Rows the transaction's locking reads return: the target user
  // (getOne) and the active admins (getMany).
  const mockLockQueryBuilder = {
    setLock: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getMany: jest.fn(),
  };
  const mockAuditRepo = { save: jest.fn() };

  // create / deactivate / reactivate / softDelete run in a transaction: its
  // manager's writes, and whether the last transaction committed or rolled
  // back.
  const mockManager = {
    update: jest.fn(),
    softDelete: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(() => mockLockQueryBuilder),
    getRepository: jest.fn(() => mockAuditRepo),
  };

  const actor = {
    id: 'admin-1',
    full_name: 'Head Admin',
    role: UserRole.ADMIN,
  };
  let transactionOutcome: 'committed' | 'rolled back' | undefined;
  const mockDataSource = {
    transaction: jest.fn(
      async (work: (manager: typeof mockManager) => Promise<unknown>) => {
        try {
          const result = await work(mockManager);
          transactionOutcome = 'committed';
          return result;
        } catch (error) {
          transactionOutcome = 'rolled back';
          throw error;
        }
      },
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    transactionOutcome = undefined;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        { provide: getRepositoryToken(Branch), useValue: mockBranchesRepo },
        { provide: TypedConfigService, useValue: mockConfig },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByEmail', () => {
    it('normalizes email to lowercase before lookup', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      await service.findByEmail('User@Test.COM');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'user.email = :email',
        { email: 'user@test.com' },
      );
    });

    it('opts password_hash back in (it is select: false on the entity)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      await service.findByEmail('a@b.com');
      expect(mockUsersRepo.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'user.password_hash',
      );
    });

    it('returns the user when found', async () => {
      const user = { id: 'u1', email: 'a@b.com', password_hash: 'x' } as User;
      mockQueryBuilder.getOne.mockResolvedValue(user);
      const result = await service.findByEmail('a@b.com');
      expect(result).toBe(user);
    });

    it('returns null when not found', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      const result = await service.findByEmail('nobody@t.com');
      expect(result).toBeNull();
    });
  });

  describe('findByIdForAuth', () => {
    it('returns the user by id without opting password_hash in', async () => {
      const user = { id: 'u1' } as User;
      mockUsersRepo.findOne.mockResolvedValue(user);
      const result = await service.findByIdForAuth('u1');
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

    it('strips the approval PIN hash, count and lock, keeping approval_pin_set_at (P6-15)', async () => {
      const setAt = new Date();
      mockUsersRepo.findOne.mockResolvedValue({
        id: 'u1',
        password_hash: 'secret',
        approval_pin_hash: '$2b$04$pin',
        approval_pin_set_at: setAt,
        approval_pin_failed_attempts: 3,
        approval_pin_locked_until: null,
        role: UserRole.MANAGER,
      });

      const result = await service.findById('u1');

      expect(result).toEqual({
        id: 'u1',
        approval_pin_set_at: setAt,
        role: UserRole.MANAGER,
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

  describe('findAll', () => {
    const listQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };

    beforeEach(() => {
      mockUsersRepo.createQueryBuilder.mockReturnValueOnce(
        listQueryBuilder as unknown as typeof mockQueryBuilder,
      );
    });

    it('returns a page of safe users with the pagination meta', async () => {
      listQueryBuilder.getManyAndCount.mockResolvedValue([
        [
          {
            id: 'u1',
            full_name: 'Manager',
            password_hash: 'secret',
            approval_pin_hash: '$2b$04$pin',
            approval_pin_failed_attempts: 2,
            approval_pin_locked_until: null,
            approval_pin_set_at: null,
          },
        ],
        3,
      ]);

      const result = await service.findAll({ page: 2, limit: 2 });

      expect(result).toEqual({
        data: [{ id: 'u1', full_name: 'Manager', approval_pin_set_at: null }],
        meta: {
          total: 3,
          page: 2,
          limit: 2,
          totalPages: 2,
          hasNext: false,
          hasPrev: true,
        },
      });
      expect(listQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'user.branch',
        'branch',
      );
      expect(listQueryBuilder.skip).toHaveBeenCalledWith(2);
      expect(listQueryBuilder.take).toHaveBeenCalledWith(2);
      expect(listQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('applies role, branch and active filters', async () => {
      listQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({
        role: UserRole.MANAGER,
        branchId: 'branch-1',
        isActive: false,
      });

      expect(listQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.role = :role',
        { role: UserRole.MANAGER },
      );
      expect(listQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.branch_id = :branchId',
        { branchId: 'branch-1' },
      );
      expect(listQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.is_active = :isActive',
        { isActive: false },
      );
    });
  });

  describe('create', () => {
    const contact = {
      phone: '0771234567',
      nic: '199012345678',
      address: '12 Temple Road, Kandy',
    };

    beforeEach(() => {
      mockUsersRepo.findOne.mockResolvedValue(null);
      mockManager.save.mockImplementation((u) =>
        Promise.resolve({ ...u, id: 'new-user' }),
      );
      mockUsersRepo.create.mockImplementation((u) => u);
    });

    it('creates an admin user without a branch', async () => {
      const result = await service.create(
        {
          email: 'admin@t.com',
          password: 'pw12345678',
          ...contact,
          full_name: 'Admin',
          role: UserRole.ADMIN,
        },
        actor,
      );

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
        service.create(
          {
            email: 'admin@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'Admin',
            role: UserRole.ADMIN,
            branch_id: 'branch-1',
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a cashier with an active branch', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(activeBranch);
      await service.create(
        {
          email: 'c@t.com',
          password: 'pw12345678',
          ...contact,
          full_name: 'Cashier',
          role: UserRole.CASHIER,
          branch_id: 'branch-1',
        },
        actor,
      );
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.CASHIER,
          branch_id: 'branch-1',
        }),
      );
    });

    describe('password byte length (bcrypt reads only 72 bytes)', () => {
      const SINHALA = 'ම'; // 1 UTF-16 unit, 3 bytes in UTF-8
      const createAdmin = (password: string) =>
        service.create(
          {
            email: 'admin@t.com',
            password,
            ...contact,
            full_name: 'Admin',
            role: UserRole.ADMIN,
          },
          actor,
        );

      it.each([
        ['72 ASCII characters', 'a'.repeat(72)],
        ['24 Sinhala letters (72 bytes)', SINHALA.repeat(24)],
      ])('hashes %s whole, untruncated', async (_, password) => {
        await createAdmin(password);
        expect(bcrypt.hash).toHaveBeenCalledWith(password, 4);
      });

      it.each([
        ['73 ASCII characters', 'a'.repeat(73)],
        ['25 Sinhala letters (75 bytes)', SINHALA.repeat(25)],
        ['71 ASCII + one 3-byte letter (74 bytes)', 'a'.repeat(71) + SINHALA],
      ])('refuses %s before hashing', async (_, password) => {
        const attempt = createAdmin(password);
        await expect(attempt).rejects.toThrow(BadRequestException);
        await expect(attempt).rejects.toThrow(PASSWORD_TOO_LONG_MESSAGE);
        expect(bcrypt.hash).not.toHaveBeenCalled();
        expect(mockManager.save).not.toHaveBeenCalled();
      });

      it('never puts the password in the error', async () => {
        const password = `secret-${'x'.repeat(80)}`;
        await expect(createAdmin(password)).rejects.toThrow(
          expect.objectContaining({
            message: expect.not.stringContaining('secret-') as string,
          }) as Error,
        );
      });
    });

    it('creates a manager with an active branch', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(activeBranch);
      await service.create(
        {
          email: 'm@t.com',
          password: 'pw12345678',
          ...contact,
          full_name: 'Manager',
          role: UserRole.MANAGER,
          branch_id: 'branch-1',
        },
        actor,
      );
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.MANAGER,
          branch_id: 'branch-1',
        }),
      );
    });

    it('defaults role to CASHIER when omitted → still requires branch_id', async () => {
      await expect(
        service.create(
          {
            email: 'x@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'X',
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cashier without branch_id (400)', async () => {
      await expect(
        service.create(
          {
            email: 'c@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'Cashier',
            role: UserRole.CASHIER,
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects manager without branch_id (400)', async () => {
      await expect(
        service.create(
          {
            email: 'm@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'Manager',
            role: UserRole.MANAGER,
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects staff with a nonexistent branch_id (400)', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create(
          {
            email: 'c@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'Cashier',
            role: UserRole.CASHIER,
            branch_id: 'ghost',
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects staff with an inactive branch_id (400)', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(inactiveBranch);
      await expect(
        service.create(
          {
            email: 'c@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'Cashier',
            role: UserRole.CASHIER,
            branch_id: 'branch-2',
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate email with ConflictException (409)', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create(
          {
            email: 'exists@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'Dup',
            role: UserRole.ADMIN,
          },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('normalizes email to lowercase before insert', async () => {
      await service.create(
        {
          email: 'Admin@Test.COM',
          password: 'pw12345678',
          ...contact,
          full_name: 'A',
          role: UserRole.ADMIN,
        },
        actor,
      );
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'admin@test.com' }),
      );
    });
    it('saves the user and its CREATE audit row in one transaction, never the password', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(activeBranch);
      await service.create(
        {
          email: 'c@t.com',
          password: 'pw12345678',
          ...contact,
          full_name: 'Cashier',
          role: UserRole.CASHIER,
          branch_id: 'branch-1',
        },
        actor,
        '10.0.0.5',
      );

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockManager.save).toHaveBeenCalledTimes(1);
      expect(mockAuditRepo.save).toHaveBeenCalledWith({
        user_id: 'admin-1',
        user_name: 'Head Admin',
        user_role: UserRole.ADMIN,
        action: AuditAction.CREATE,
        entity_type: 'User',
        entity_id: 'new-user',
        changes: {
          email: { old: null, new: 'c@t.com' },
          full_name: { old: null, new: 'Cashier' },
          phone: { old: null, new: '0771234567' },
          nic: { old: null, new: '199012345678' },
          address: { old: null, new: '12 Temple Road, Kandy' },
          role: { old: null, new: UserRole.CASHIER },
          branch_id: { old: null, new: 'branch-1' },
        },
        description: 'User Cashier created as cashier.',
        ip_address: '10.0.0.5',
      });
      expect(JSON.stringify(mockAuditRepo.save.mock.calls)).not.toContain(
        'pw12345678',
      );
      expect(JSON.stringify(mockAuditRepo.save.mock.calls)).not.toContain(
        'hashed-password',
      );
      expect(transactionOutcome).toBe('committed');
    });

    it('maps a racing duplicate email (23505 on idx_users_email) to 409, with no audit row', async () => {
      mockManager.save.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'idx_users_email',
        }),
      );
      await expect(
        service.create(
          {
            email: 'admin@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'Admin',
            role: UserRole.ADMIN,
          },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
      expect(transactionOutcome).toBe('rolled back');
    });

    it('rolls the user back when the audit row fails', async () => {
      const failure = new Error('connection lost');
      mockAuditRepo.save.mockRejectedValueOnce(failure);
      await expect(
        service.create(
          {
            email: 'admin@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'Admin',
            role: UserRole.ADMIN,
          },
          actor,
        ),
      ).rejects.toBe(failure);
      expect(transactionOutcome).toBe('rolled back');
    });

    it('stores the contact details', async () => {
      await service.create(
        {
          email: 'admin@t.com',
          password: 'pw12345678',
          ...contact,
          full_name: 'Admin',
          role: UserRole.ADMIN,
        },
        actor,
      );
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining(contact),
      );
    });

    it('refuses an NIC another user holds (409 NIC_ALREADY_REGISTERED) before hashing', async () => {
      mockUsersRepo.findOne
        .mockResolvedValueOnce(null) // the email is free
        .mockResolvedValueOnce({ id: 'other' }); // the NIC isn't
      const attempt = service.create(
        {
          email: 'admin@t.com',
          password: 'pw12345678',
          ...contact,
          full_name: 'Admin',
          role: UserRole.ADMIN,
        },
        actor,
      );
      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'NIC_ALREADY_REGISTERED' },
      });
      expect(mockUsersRepo.findOne).toHaveBeenLastCalledWith({
        where: { nic: '199012345678' },
      });
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('maps a racing duplicate NIC (23505 on idx_users_nic_unique) to 409, with no audit row', async () => {
      mockManager.save.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'idx_users_nic_unique',
        }),
      );
      await expect(
        service.create(
          {
            email: 'admin@t.com',
            password: 'pw12345678',
            ...contact,
            full_name: 'Admin',
            role: UserRole.ADMIN,
          },
          actor,
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'NIC_ALREADY_REGISTERED' },
      });
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
      expect(transactionOutcome).toBe('rolled back');
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
    it('changes the contact number and address', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ ...cashier });
      mockUsersRepo.save.mockImplementation((u) => Promise.resolve(u));
      const result = await service.update('u1', {
        phone: '0712345678',
        address: '4 Lake Road, Galle',
      });
      expect(result).toMatchObject({
        phone: '0712345678',
        address: '4 Lake Road, Galle',
      });
    });

    it('changes the NIC after checking no other user holds it', async () => {
      mockUsersRepo.findOne
        .mockResolvedValueOnce({ ...cashier, nic: '901234567V' })
        .mockResolvedValueOnce(null);
      mockUsersRepo.save.mockImplementation((u) => Promise.resolve(u));
      const result = await service.update('u1', { nic: '199012345678' });
      expect(result.nic).toBe('199012345678');
      expect(mockUsersRepo.findOne).toHaveBeenLastCalledWith({
        where: { nic: '199012345678', id: Not('u1') },
      });
    });

    it('skips the NIC check when the NIC is unchanged', async () => {
      mockUsersRepo.findOne.mockResolvedValue({
        ...cashier,
        nic: '901234567V',
      });
      mockUsersRepo.save.mockImplementation((u) => Promise.resolve(u));
      await service.update('u1', { nic: '901234567V' });
      expect(mockUsersRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('refuses an NIC another user holds (409), saving nothing', async () => {
      mockUsersRepo.findOne
        .mockResolvedValueOnce({ ...cashier })
        .mockResolvedValueOnce({ id: 'other' });
      await expect(
        service.update('u1', { nic: '199012345678' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'NIC_ALREADY_REGISTERED' },
      });
      expect(mockUsersRepo.save).not.toHaveBeenCalled();
    });

    it.each([
      [
        'NIC',
        'idx_users_nic_unique',
        { nic: '199012345678' },
        'NIC is already registered',
      ],
      [
        'email',
        'idx_users_email',
        { email: 'n@t.com' },
        'Email is already registered',
      ],
    ])(
      'maps a racing duplicate %s on save to 409',
      async (_, constraint, change, message) => {
        mockUsersRepo.findOne
          .mockResolvedValueOnce({ ...cashier })
          .mockResolvedValueOnce(null);
        mockUsersRepo.save.mockRejectedValueOnce(
          Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint,
          }),
        );
        await expect(service.update('u1', change)).rejects.toThrow(message);
      },
    );

    it('refuses a null branch_id (400) without looking a branch up', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ ...cashier });
      await expect(
        service.update('u1', { branch_id: null as unknown as string }),
      ).rejects.toThrow('branch_id must not be null');
      expect(mockBranchesRepo.findOne).not.toHaveBeenCalled();
      expect(mockUsersRepo.save).not.toHaveBeenCalled();
    });
  });

  // The user's unrevoked refresh tokens, revoked in the same transaction.
  const tokenRevocation = [
    RefreshToken,
    { user_id: 'u1', revoked_at: IsNull() },
    { revoked_at: expect.any(Date) as Date },
  ];
  const isTokenRevocation = (entity: unknown) => entity === RefreshToken;

  describe('changeRole', () => {
    const setAt = new Date('2026-10-01T00:00:00.000Z');
    const managerRow = {
      id: 'u1',
      full_name: 'Shop Manager',
      role: UserRole.MANAGER,
      branch_id: 'branch-1',
      is_active: true,
      approval_pin_set_at: setAt,
    };
    const adminRow = {
      id: 'u1',
      full_name: 'Second Admin',
      role: UserRole.ADMIN,
      branch_id: null,
      is_active: true,
      approval_pin_set_at: null,
    };
    const lockRows = (target: object | null, admins: object[]) => {
      mockLockQueryBuilder.getOne.mockResolvedValue(target);
      mockLockQueryBuilder.getMany.mockResolvedValue(admins);
    };
    const pinCleared = {
      approval_pin_hash: null,
      approval_pin_set_at: null,
      approval_pin_failed_attempts: 0,
      approval_pin_locked_until: null,
    };

    beforeEach(() => {
      mockManager.update.mockResolvedValue({ affected: 1 });
      mockBranchesRepo.findOne.mockResolvedValue(activeBranch);
    });

    it('demotes a manager to cashier: clears the PIN in the same UPDATE, revokes tokens and audits, in one transaction', async () => {
      lockRows(managerRow, [{ id: 'admin-1' }]);

      await service.changeRole(
        'u1',
        { role: UserRole.CASHIER, branch_id: 'branch-1' },
        actor,
        '10.0.0.5',
      );

      expect(mockManager.update).toHaveBeenNthCalledWith(1, User, 'u1', {
        role: UserRole.CASHIER,
        branch_id: 'branch-1',
        ...pinCleared,
      });
      expect(mockManager.update).toHaveBeenNthCalledWith(2, ...tokenRevocation);
      expect(mockAuditRepo.save).toHaveBeenCalledWith({
        user_id: 'admin-1',
        user_name: 'Head Admin',
        user_role: UserRole.ADMIN,
        action: AuditAction.ROLE_CHANGED,
        entity_type: 'User',
        entity_id: 'u1',
        changes: {
          role: { old: UserRole.MANAGER, new: UserRole.CASHIER },
          branch_id: { old: 'branch-1', new: 'branch-1' },
          approval_pin_set_at: { old: setAt, new: null },
        },
        description:
          'Role of Shop Manager changed from manager to cashier. Approval PIN cleared.',
        ip_address: '10.0.0.5',
      });
      expect(transactionOutcome).toBe('committed');
    });

    it('promotes a manager to admin: branch cleared, PIN kept', async () => {
      lockRows(managerRow, [{ id: 'admin-1' }]);

      await service.changeRole('u1', { role: UserRole.ADMIN }, actor);

      expect(mockManager.update).toHaveBeenNthCalledWith(1, User, 'u1', {
        role: UserRole.ADMIN,
        branch_id: null,
      });
      expect(mockBranchesRepo.findOne).not.toHaveBeenCalled();
    });

    it('accepts branch_id: null for an admin', async () => {
      lockRows(managerRow, [{ id: 'admin-1' }]);
      await service.changeRole(
        'u1',
        { role: UserRole.ADMIN, branch_id: null },
        actor,
      );
      expect(mockManager.update).toHaveBeenNthCalledWith(1, User, 'u1', {
        role: UserRole.ADMIN,
        branch_id: null,
      });
    });

    it('moves an admin to manager at an active branch while another admin remains', async () => {
      lockRows(adminRow, [{ id: 'admin-1' }, adminRow]);
      await service.changeRole(
        'u1',
        { role: UserRole.MANAGER, branch_id: 'branch-1' },
        actor,
      );
      expect(mockManager.update).toHaveBeenNthCalledWith(1, User, 'u1', {
        role: UserRole.MANAGER,
        branch_id: 'branch-1',
      });
      expect(transactionOutcome).toBe('committed');
    });

    it('transfers a staff user, keeping the role, as a branch move', async () => {
      lockRows(managerRow, [{ id: 'admin-1' }]);
      await service.changeRole(
        'u1',
        { role: UserRole.MANAGER, branch_id: 'branch-9' },
        actor,
      );
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            role: { old: UserRole.MANAGER, new: UserRole.MANAGER },
            branch_id: { old: 'branch-1', new: 'branch-9' },
          },
          description: 'Shop Manager moved to another branch as manager.',
        }),
      );
    });

    it('changes nothing when the role and branch are already set', async () => {
      lockRows(managerRow, [{ id: 'admin-1' }]);
      await service.changeRole(
        'u1',
        { role: UserRole.MANAGER, branch_id: 'branch-1' },
        actor,
      );
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });

    it.each([
      ['staff without a branch', { role: UserRole.CASHIER }],
      ['staff with a null branch', { role: UserRole.MANAGER, branch_id: null }],
      ['an admin with a branch', { role: UserRole.ADMIN, branch_id: 'b' }],
    ])('400 for %s, before any lock', async (_, dto) => {
      await expect(service.changeRole('u1', dto, actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('400 for staff at an inactive branch', async () => {
      mockBranchesRepo.findOne.mockResolvedValue(inactiveBranch);
      await expect(
        service.changeRole(
          'u1',
          { role: UserRole.CASHIER, branch_id: 'branch-2' },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it("refuses the caller's own account (400 CANNOT_CHANGE_OWN_ROLE)", async () => {
      await expect(
        service.changeRole(
          'admin-1',
          { role: UserRole.MANAGER, branch_id: 'branch-1' },
          actor,
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          code: 'CANNOT_CHANGE_OWN_ROLE',
        }) as object,
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses demoting the last active admin (400 LAST_ACTIVE_ADMIN), changing nothing', async () => {
      lockRows(adminRow, [adminRow]);
      await expect(
        service.changeRole(
          'u1',
          { role: UserRole.CASHIER, branch_id: 'branch-1' },
          actor,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'LAST_ACTIVE_ADMIN',
        }) as object,
      });
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(transactionOutcome).toBe('rolled back');
    });

    it('demotes an inactive admin even when only one admin is active', async () => {
      lockRows({ ...adminRow, is_active: false }, [{ id: 'admin-1' }]);
      await service.changeRole(
        'u1',
        { role: UserRole.CASHIER, branch_id: 'branch-1' },
        actor,
      );
      expect(transactionOutcome).toBe('committed');
    });

    it('locks the active admins before the target user', async () => {
      lockRows(managerRow, [{ id: 'admin-1' }]);
      await service.changeRole('u1', { role: UserRole.ADMIN }, actor);
      expect(
        mockLockQueryBuilder.getMany.mock.invocationCallOrder[0],
      ).toBeLessThan(mockLockQueryBuilder.getOne.mock.invocationCallOrder[0]);
    });

    it('throws NotFoundException for an unknown user', async () => {
      lockRows(null, [{ id: 'admin-1' }]);
      await expect(
        service.changeRole('missing', { role: UserRole.ADMIN }, actor),
      ).rejects.toThrow(NotFoundException);
      expect(mockManager.update).not.toHaveBeenCalled();
    });

    it('rolls the change back when the audit row fails', async () => {
      lockRows(managerRow, [{ id: 'admin-1' }]);
      const failure = new Error('connection lost');
      mockAuditRepo.save.mockRejectedValueOnce(failure);
      await expect(
        service.changeRole('u1', { role: UserRole.ADMIN }, actor),
      ).rejects.toBe(failure);
      expect(transactionOutcome).toBe('rolled back');
    });
  });

  describe('resetPassword', () => {
    const targetRow = { id: 'u1', full_name: 'Shop Cashier' };

    beforeEach(() => {
      mockManager.update.mockResolvedValue({ affected: 1 });
    });

    it('hashes the new password, revokes tokens and audits, in one transaction', async () => {
      mockLockQueryBuilder.getOne.mockResolvedValue(targetRow);

      await service.resetPassword(
        'u1',
        { new_password: 'brand-new-pass' },
        actor,
        '10.0.0.5',
      );

      expect(bcrypt.hash).toHaveBeenCalledWith('brand-new-pass', 4);
      expect(mockManager.update).toHaveBeenNthCalledWith(1, User, 'u1', {
        password_hash: 'hashed-password',
      });
      expect(mockManager.update).toHaveBeenNthCalledWith(2, ...tokenRevocation);
      expect(mockAuditRepo.save).toHaveBeenCalledWith({
        user_id: 'admin-1',
        user_name: 'Head Admin',
        user_role: UserRole.ADMIN,
        action: AuditAction.PASSWORD_RESET,
        entity_type: 'User',
        entity_id: 'u1',
        changes: null,
        description: 'Password of Shop Cashier reset by an admin.',
        ip_address: '10.0.0.5',
      });
      expect(transactionOutcome).toBe('committed');
    });

    it("refuses the caller's own account (400 CANNOT_RESET_OWN_PASSWORD) before hashing", async () => {
      await expect(
        service.resetPassword(
          'admin-1',
          { new_password: 'brand-new-pass' },
          actor,
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          code: 'CANNOT_RESET_OWN_PASSWORD',
        }) as object,
      });
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses a password over 72 bytes before hashing', async () => {
      await expect(
        service.resetPassword('u1', { new_password: 'é'.repeat(37) }, actor),
      ).rejects.toThrow(PASSWORD_TOO_LONG_MESSAGE);
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown user, changing nothing', async () => {
      mockLockQueryBuilder.getOne.mockResolvedValue(null);
      await expect(
        service.resetPassword(
          'missing',
          { new_password: 'brand-new-pass' },
          actor,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });

    it('rolls the change back when the audit row fails', async () => {
      mockLockQueryBuilder.getOne.mockResolvedValue(targetRow);
      const failure = new Error('connection lost');
      mockAuditRepo.save.mockRejectedValueOnce(failure);
      await expect(
        service.resetPassword('u1', { new_password: 'brand-new-pass' }, actor),
      ).rejects.toBe(failure);
      expect(transactionOutcome).toBe('rolled back');
    });
  });

  describe('changeOwnPassword', () => {
    const self = {
      id: 'u1',
      full_name: 'Shop Cashier',
      role: UserRole.CASHIER,
    };
    const dto = {
      current_password: 'old-password',
      new_password: 'brand-new-pass',
    };
    const compare = bcrypt.compare as jest.Mock;
    // bcrypt.compare(plain, hash) matches only the given plain password.
    const passwordIs = (stored: string) =>
      compare.mockImplementation((plain: string) =>
        Promise.resolve(plain === stored),
      );

    beforeEach(() => {
      mockManager.update.mockResolvedValue({ affected: 1 });
      mockLockQueryBuilder.getOne.mockResolvedValue({
        id: 'u1',
        password_hash: 'stored-hash',
      });
      passwordIs('old-password');
    });

    it('checks the current password on the locked row, then hashes, revokes and audits', async () => {
      await service.changeOwnPassword(self, dto, '10.0.0.7');

      expect(mockLockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
      expect(mockLockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'user.password_hash',
      );
      expect(compare).toHaveBeenCalledWith('old-password', 'stored-hash');
      expect(bcrypt.hash).toHaveBeenCalledWith('brand-new-pass', 4);
      expect(mockManager.update).toHaveBeenNthCalledWith(1, User, 'u1', {
        password_hash: 'hashed-password',
      });
      expect(mockManager.update).toHaveBeenNthCalledWith(2, ...tokenRevocation);
      expect(mockAuditRepo.save).toHaveBeenCalledWith({
        user_id: 'u1',
        user_name: 'Shop Cashier',
        user_role: UserRole.CASHIER,
        action: AuditAction.PASSWORD_CHANGED,
        entity_type: 'User',
        entity_id: 'u1',
        changes: null,
        description: 'Password changed.',
        ip_address: '10.0.0.7',
      });
      expect(transactionOutcome).toBe('committed');
    });

    it('403 WRONG_PASSWORD for a wrong current password, writing nothing', async () => {
      passwordIs('something-else');
      await expect(service.changeOwnPassword(self, dto)).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: 'WRONG_PASSWORD',
        }) as object,
      });
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });

    it('400 SAME_PASSWORD when the new password matches the stored hash', async () => {
      compare.mockResolvedValue(true);
      await expect(service.changeOwnPassword(self, dto)).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          code: 'SAME_PASSWORD',
        }) as object,
      });
      expect(compare).toHaveBeenLastCalledWith('brand-new-pass', 'stored-hash');
      expect(mockManager.update).not.toHaveBeenCalled();
    });

    it('refuses a new password over 72 bytes before any lock', async () => {
      await expect(
        service.changeOwnPassword(self, {
          ...dto,
          new_password: 'é'.repeat(37),
        }),
      ).rejects.toThrow(PASSWORD_TOO_LONG_MESSAGE);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('rolls the change back when the audit row fails', async () => {
      const failure = new Error('connection lost');
      mockAuditRepo.save.mockRejectedValueOnce(failure);
      await expect(service.changeOwnPassword(self, dto)).rejects.toBe(failure);
      expect(transactionOutcome).toBe('rolled back');
    });
  });

  describe('deactivate', () => {
    const cashierRow = {
      id: 'u1',
      full_name: 'Cashier',
      role: UserRole.CASHIER,
      is_active: true,
    };
    const otherAdmin = {
      id: 'u1',
      full_name: 'Second Admin',
      role: UserRole.ADMIN,
      is_active: true,
    };
    const lockRows = (target: object | null, admins: object[]) => {
      mockLockQueryBuilder.getOne.mockResolvedValue(target);
      mockLockQueryBuilder.getMany.mockResolvedValue(admins);
    };

    beforeEach(() => {
      mockManager.update.mockResolvedValue({ affected: 1 });
    });

    it('flips is_active to false, clears the approval PIN (P6-15), revokes refresh tokens and audits, in one transaction', async () => {
      lockRows(cashierRow, [{ id: 'admin-1' }]);
      await service.deactivate('u1', actor, '10.0.0.5');

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockManager.update).toHaveBeenNthCalledWith(1, User, 'u1', {
        is_active: false,
        approval_pin_hash: null,
        approval_pin_set_at: null,
        approval_pin_failed_attempts: 0,
        approval_pin_locked_until: null,
      });
      expect(mockManager.update).toHaveBeenNthCalledWith(2, ...tokenRevocation);
      expect(mockAuditRepo.save).toHaveBeenCalledWith({
        user_id: 'admin-1',
        user_name: 'Head Admin',
        user_role: UserRole.ADMIN,
        action: AuditAction.DEACTIVATE,
        entity_type: 'User',
        entity_id: 'u1',
        changes: { is_active: { old: true, new: false } },
        description: 'User Cashier deactivated.',
        ip_address: '10.0.0.5',
      });
      expect(transactionOutcome).toBe('committed');
      expect(mockUsersRepo.update).not.toHaveBeenCalled();
    });

    it('locks the active admins before the target user', async () => {
      lockRows(cashierRow, [{ id: 'admin-1' }]);
      await service.deactivate('u1', actor);

      expect(mockLockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
      expect(
        mockLockQueryBuilder.getMany.mock.invocationCallOrder[0],
      ).toBeLessThan(mockLockQueryBuilder.getOne.mock.invocationCallOrder[0]);
      expect(mockLockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'user.id',
        'ASC',
      );
    });

    it("refuses the caller's own account (400 CANNOT_DEACTIVATE_SELF) before any write", async () => {
      await expect(service.deactivate('admin-1', actor)).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          code: 'CANNOT_DEACTIVATE_SELF',
        }) as object,
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
      expect(mockManager.update).not.toHaveBeenCalled();
    });

    it('refuses the last active admin (400 LAST_ACTIVE_ADMIN), changing nothing', async () => {
      lockRows(otherAdmin, [otherAdmin]);
      await expect(service.deactivate('u1', actor)).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          code: 'LAST_ACTIVE_ADMIN',
        }) as object,
      });
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
      expect(transactionOutcome).toBe('rolled back');
    });

    it('deactivates an admin while another active admin remains', async () => {
      lockRows(otherAdmin, [{ id: 'admin-1' }, otherAdmin]);
      await service.deactivate('u1', actor);
      expect(mockManager.update).toHaveBeenCalledTimes(2);
      expect(transactionOutcome).toBe('committed');
    });

    it('throws NotFoundException when user does not exist, revoking nothing', async () => {
      lockRows(null, [{ id: 'admin-1' }]);
      await expect(service.deactivate('missing', actor)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(transactionOutcome).toBe('rolled back');
    });

    it('rolls the deactivation back when revoking the tokens fails', async () => {
      lockRows(cashierRow, [{ id: 'admin-1' }]);
      const failure = new Error('connection lost');
      mockManager.update.mockImplementation((entity: unknown) =>
        isTokenRevocation(entity)
          ? Promise.reject(failure)
          : Promise.resolve({ affected: 1 }),
      );
      await expect(service.deactivate('u1', actor)).rejects.toBe(failure);
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
      expect(transactionOutcome).toBe('rolled back');
    });

    it('can be repeated on an already inactive user, revoking again without a second audit row', async () => {
      lockRows({ ...cashierRow, is_active: false }, [{ id: 'admin-1' }]);
      await service.deactivate('u1', actor);
      await service.deactivate('u1', actor);
      const revocations = mockManager.update.mock.calls.filter(([entity]) =>
        isTokenRevocation(entity),
      );
      expect(revocations).toEqual([tokenRevocation, tokenRevocation]);
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
      expect(transactionOutcome).toBe('committed');
    });
  });

  describe('reactivate', () => {
    const inactiveCashier = {
      id: 'u1',
      full_name: 'Cashier',
      role: UserRole.CASHIER,
      branch_id: 'branch-1',
      is_active: false,
    };

    beforeEach(() => {
      mockManager.update.mockResolvedValue({ affected: 1 });
    });

    it('revokes old refresh tokens, sets is_active and audits, in one transaction, keeping role and branch', async () => {
      mockLockQueryBuilder.getOne.mockResolvedValue(inactiveCashier);
      mockBranchesRepo.findOne.mockResolvedValue(activeBranch);

      await service.reactivate('u1', actor, '10.0.0.5');

      expect(mockManager.update).toHaveBeenNthCalledWith(1, ...tokenRevocation);
      expect(mockManager.update).toHaveBeenNthCalledWith(2, User, 'u1', {
        is_active: true,
      });
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.REACTIVATE,
          entity_id: 'u1',
          user_id: 'admin-1',
          changes: { is_active: { old: false, new: true } },
          ip_address: '10.0.0.5',
        }),
      );
      expect(transactionOutcome).toBe('committed');
    });

    it('refuses a staff user whose branch is inactive (400), changing nothing', async () => {
      mockLockQueryBuilder.getOne.mockResolvedValue(inactiveCashier);
      mockBranchesRepo.findOne.mockResolvedValue(inactiveBranch);

      await expect(service.reactivate('u1', actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(transactionOutcome).toBe('rolled back');
    });

    it('reactivates an admin without a branch check', async () => {
      mockLockQueryBuilder.getOne.mockResolvedValue({
        ...inactiveCashier,
        role: UserRole.ADMIN,
        branch_id: null,
      });
      await service.reactivate('u1', actor);
      expect(mockBranchesRepo.findOne).not.toHaveBeenCalled();
      expect(mockManager.update).toHaveBeenCalledTimes(2);
    });

    it('leaves an already active user alone: no revocation, no audit', async () => {
      mockLockQueryBuilder.getOne.mockResolvedValue({
        ...inactiveCashier,
        is_active: true,
      });
      await service.reactivate('u1', actor);
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockLockQueryBuilder.getOne.mockResolvedValue(null);
      await expect(service.reactivate('missing', actor)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockManager.update).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    beforeEach(() => {
      mockManager.update.mockResolvedValue({ affected: 2 });
    });

    it('soft-deletes the user and revokes refresh tokens, in one transaction', async () => {
      mockManager.softDelete.mockResolvedValue({ affected: 1 });
      await service.softDelete('u1');

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockManager.softDelete).toHaveBeenCalledWith(User, 'u1');
      expect(mockManager.update).toHaveBeenCalledWith(...tokenRevocation);
      expect(transactionOutcome).toBe('committed');
      expect(mockUsersRepo.softDelete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when user does not exist, revoking nothing', async () => {
      mockManager.softDelete.mockResolvedValue({ affected: 0 });
      await expect(service.softDelete('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(transactionOutcome).toBe('rolled back');
    });

    it('rolls the soft delete back when revoking the tokens fails', async () => {
      const failure = new Error('connection lost');
      mockManager.softDelete.mockResolvedValue({ affected: 1 });
      mockManager.update.mockRejectedValue(failure);
      await expect(service.softDelete('u1')).rejects.toBe(failure);
      expect(transactionOutcome).toBe('rolled back');
    });

    it('can be repeated, revoking again', async () => {
      mockManager.softDelete.mockResolvedValue({ affected: 1 });
      await service.softDelete('u1');
      await service.softDelete('u1');
      expect(mockManager.update).toHaveBeenCalledTimes(2);
      expect(transactionOutcome).toBe('committed');
    });
  });
});
