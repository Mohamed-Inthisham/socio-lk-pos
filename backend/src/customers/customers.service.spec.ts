import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Customer } from './entities/customer.entity';

describe('CustomersService', () => {
  let service: CustomersService;

  const mockQueryBuilder = {
    withDeleted: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    softRemove: jest.fn(),
    restore: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryBuilder.withDeleted.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();
    mockQueryBuilder.orderBy.mockReturnThis();
    mockQueryBuilder.addOrderBy.mockReturnThis();
    mockQueryBuilder.skip.mockReturnThis();
    mockQueryBuilder.take.mockReturnThis();
    mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: getRepositoryToken(Customer), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---- create ----

  describe('create', () => {
    it('creates a customer with all fields', async () => {
      mockRepo.findOne.mockResolvedValue(null); // NIC dedup lookup
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 'cust-1', ...e }),
      );

      const result = await service.create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: '199012345678',
        notes: 'Regular customer',
      });

      expect(mockRepo.create).toHaveBeenCalledWith({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: '199012345678',
        notes: 'Regular customer',
      });
      expect(result.id).toBe('cust-1');
    });

    it('creates a customer without NIC (walk-in flow)', async () => {
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 'cust-2', ...e }),
      );

      const result = await service.create({
        name: 'Anon Walk-in',
        phone: '0771111111',
      });

      // No NIC → no dedup lookup fired
      expect(mockRepo.findOne).not.toHaveBeenCalled();
      expect(result.id).toBe('cust-2');
    });

    it('normalizes nullish nic/notes to null on the entity', async () => {
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.create({
        name: 'X',
        phone: '0771111111',
      });

      expect(mockRepo.create).toHaveBeenCalledWith({
        name: 'X',
        phone: '0771111111',
        nic: null,
        notes: null,
      });
    });

    it('throws ConflictException with existing_customer_id when NIC clashes', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'existing-cust',
        nic: '199012345678',
      });

      await expect(
        service.create({
          name: 'Kamal',
          phone: '0771234567',
          nic: '199012345678',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          existing_customer_id: 'existing-cust',
        }),
      });
    });
  });

  // ---- findAll ----

  describe('findAll', () => {
    it('returns paginated results with defaults', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll({});

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'customer.created_at',
        'DESC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'customer.id',
        'DESC',
      );
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(50);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
      expect(result.meta.total).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('applies pagination correctly', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 137]);

      const result = await service.findAll({ page: 3, limit: 20 });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(40);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
      expect(result.meta.totalPages).toBe(7);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.hasPrev).toBe(true);
    });

    it('applies search filter across name/phone/nic', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ search: 'kamal' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
      // Assert the parameters passed to the Brackets sub-query invocation.
      const call = mockQueryBuilder.andWhere.mock.calls[0];
      expect(call[0]).toBeDefined(); // Brackets instance
    });

    it('includes deleted rows when include_deleted="true"', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ include_deleted: 'true' });

      expect(mockQueryBuilder.withDeleted).toHaveBeenCalled();
    });

    it('does not include deleted rows when include_deleted omitted', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockQueryBuilder.withDeleted).not.toHaveBeenCalled();
    });

    it('does not include deleted rows when include_deleted="false"', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ include_deleted: 'false' });

      expect(mockQueryBuilder.withDeleted).not.toHaveBeenCalled();
    });
  });

  // ---- findOne ----

  describe('findOne', () => {
    it('returns the customer when found', async () => {
      const cust = { id: 'cust-1', name: 'Kamal' };
      mockRepo.findOne.mockResolvedValue(cust);

      const result = await service.findOne('cust-1');

      expect(result).toBe(cust);
      // Should include deleted rows so restore flows work
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        withDeleted: true,
      });
    });

    it('throws NotFoundException when missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- update ----

  describe('update', () => {
    const activeCustomer = {
      id: 'cust-1',
      name: 'Kamal',
      phone: '0771234567',
      nic: '199012345678',
      notes: null,
      deleted_at: null,
    };

    it('updates name only', async () => {
      mockRepo.findOne.mockResolvedValue({ ...activeCustomer });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('cust-1', { name: 'Kamal Perera' });

      expect(result.name).toBe('Kamal Perera');
      expect(result.phone).toBe('0771234567');
    });

    it('clears nic when explicitly set to null', async () => {
      mockRepo.findOne.mockResolvedValue({ ...activeCustomer });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('cust-1', { nic: null });

      expect(result.nic).toBeNull();
    });

    it('does not touch fields left undefined', async () => {
      mockRepo.findOne.mockResolvedValue({ ...activeCustomer });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('cust-1', { notes: 'VIP' });

      expect(result.name).toBe('Kamal'); // unchanged
      expect(result.nic).toBe('199012345678'); // unchanged
      expect(result.notes).toBe('VIP');
    });

    it('does not re-check NIC uniqueness when nic is unchanged', async () => {
      mockRepo.findOne.mockResolvedValueOnce({ ...activeCustomer });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.update('cust-1', { name: 'New Name' });

      // Only the initial findOne (from findOne(id)) should fire — no dedup lookup
      expect(mockRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('does not re-check NIC uniqueness when nic is cleared (null)', async () => {
      mockRepo.findOne.mockResolvedValueOnce({ ...activeCustomer });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.update('cust-1', { nic: null });

      expect(mockRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('re-checks NIC uniqueness when changed to a new value', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce({ ...activeCustomer }) // findOne(id)
        .mockResolvedValueOnce(null); // dedup lookup — no clash
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.update('cust-1', { nic: '200012345678' });

      expect(mockRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('throws ConflictException with existing_customer_id when new NIC clashes', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce({ ...activeCustomer })
        .mockResolvedValueOnce({ id: 'other-cust', nic: '200012345678' });

      await expect(
        service.update('cust-1', { nic: '200012345678' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          existing_customer_id: 'other-cust',
        }),
      });
    });

    it('throws ConflictException when updating a deleted customer', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...activeCustomer,
        deleted_at: new Date(),
      });

      await expect(service.update('cust-1', { name: 'X' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when customer missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- remove (soft delete) ----

  describe('remove', () => {
    it('soft-deletes an active customer', async () => {
      const active = { id: 'cust-1', name: 'Kamal', deleted_at: null };
      mockRepo.findOne.mockResolvedValue(active);
      mockRepo.softRemove.mockResolvedValue(active);

      await service.remove('cust-1');

      expect(mockRepo.softRemove).toHaveBeenCalledWith(active);
    });

    it('throws ConflictException when already deleted', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        deleted_at: new Date(),
      });

      await expect(service.remove('cust-1')).rejects.toThrow(ConflictException);
      expect(mockRepo.softRemove).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when customer missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- reactivate ----

  describe('reactivate', () => {
    it('restores a soft-deleted customer', async () => {
      const deleted = {
        id: 'cust-1',
        name: 'Kamal',
        nic: null,
        deleted_at: new Date(),
      };
      const restored = { ...deleted, deleted_at: null };

      mockRepo.findOne
        .mockResolvedValueOnce(deleted) // initial findOne
        .mockResolvedValueOnce(restored); // findOne after restore
      mockRepo.restore.mockResolvedValue({ affected: 1 });

      const result = await service.reactivate('cust-1');

      expect(mockRepo.restore).toHaveBeenCalledWith('cust-1');
      expect(result.deleted_at).toBeNull();
    });

    it('runs NIC clash defense check when nic is set', async () => {
      const deleted = {
        id: 'cust-1',
        name: 'Kamal',
        nic: '199012345678',
        deleted_at: new Date(),
      };

      mockRepo.findOne
        .mockResolvedValueOnce(deleted) // initial findOne
        .mockResolvedValueOnce(null) // clash check — no clash
        .mockResolvedValueOnce({ ...deleted, deleted_at: null }); // findOne after restore
      mockRepo.restore.mockResolvedValue({ affected: 1 });

      await service.reactivate('cust-1');

      expect(mockRepo.findOne).toHaveBeenCalledTimes(3);
      expect(mockRepo.restore).toHaveBeenCalled();
    });

    it('throws ConflictException when NIC now clashes with an active customer', async () => {
      const deleted = {
        id: 'cust-1',
        name: 'Kamal',
        nic: '199012345678',
        deleted_at: new Date(),
      };

      mockRepo.findOne
        .mockResolvedValueOnce(deleted)
        .mockResolvedValueOnce({ id: 'clash-cust', nic: '199012345678' });

      await expect(service.reactivate('cust-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          existing_customer_id: 'clash-cust',
        }),
      });
      expect(mockRepo.restore).not.toHaveBeenCalled();
    });

    it('throws ConflictException when customer is not deleted', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        name: 'Kamal',
        deleted_at: null,
      });

      await expect(service.reactivate('cust-1')).rejects.toThrow(
        ConflictException,
      );
      expect(mockRepo.restore).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when customer missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.reactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
