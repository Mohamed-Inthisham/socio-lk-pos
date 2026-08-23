import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { Supplier } from './entities/supplier.entity';

describe('SuppliersService', () => {
  let service: SuppliersService;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Re-establish the query builder chain after clearAllMocks
    mockQueryBuilder.where.mockReturnThis();
    mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: getRepositoryToken(Supplier), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a supplier with the provided name (post-DTO normalization)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 's1', ...e }),
      );

      // The DTO's @Transform trims the name before the service is called.
      const result = await service.create({ name: 'Ranjith Mobile' });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ranjith Mobile' }),
      );
      expect(result.name).toBe('Ranjith Mobile');
    });

    it('normalizes optional string fields to null when omitted', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.create({ name: 'Ranjith Mobile' });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_person: null,
          phone: null,
          email: null,
          address: null,
          notes: null,
        }),
      );
    });

    it('stores all provided optional fields (post-DTO normalization)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      // The DTO's @Transform trims strings before the service is called.
      // Test the post-transform contract with already-trimmed values.
      await service.create({
        name: 'Ranjith Mobile',
        contact_person: 'Ranjith',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45, Galle Road',
        notes: '30-day terms',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_person: 'Ranjith',
          phone: '0771234567',
          email: 'ranjith@shop.lk',
          address: 'No 45, Galle Road',
          notes: '30-day terms',
        }),
      );
    });

    it('stores null for optional fields when null is passed (post-DTO normalization)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      // The DTO's @Transform converts empty strings to null before the
      // service is called. Test the post-transform contract directly.
      await service.create({
        name: 'Ranjith Mobile',
        contact_person: null as unknown as string,
        phone: null as unknown as string,
        email: null as unknown as string,
        address: null as unknown as string,
        notes: null as unknown as string,
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_person: null,
          phone: null,
          email: null,
          address: null,
          notes: null,
        }),
      );
    });

    it('throws ConflictException when name already exists (case-insensitive)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue({
        id: 'existing',
        name: 'Ranjith Mobile',
      });

      await expect(service.create({ name: 'ranjith mobile' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('returns only active suppliers by default, sorted by name ASC', async () => {
      const suppliers = [{ id: 's1', name: 'Ranjith Mobile', is_active: true }];
      mockRepo.find.mockResolvedValue(suppliers);

      const result = await service.findAll();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { is_active: true },
        order: { name: 'ASC' },
      });
      expect(result).toBe(suppliers);
    });

    it('returns all suppliers when includeInactive is true', async () => {
      const suppliers = [
        { id: 's1', name: 'Ranjith Mobile', is_active: true },
        { id: 's2', name: 'Old Supplier', is_active: false },
      ];
      mockRepo.find.mockResolvedValue(suppliers);

      const result = await service.findAll(true);

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { name: 'ASC' },
      });
      expect(result).toBe(suppliers);
    });
  });

  describe('findOne', () => {
    it('returns the supplier when found', async () => {
      const supplier = { id: 's1', name: 'Ranjith Mobile' };
      mockRepo.findOne.mockResolvedValue(supplier);

      const result = await service.findOne('s1');

      expect(result).toBe(supplier);
    });

    it('throws NotFoundException when the supplier does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('partially updates a supplier', async () => {
      const existing = {
        id: 's1',
        name: 'Ranjith Mobile',
        contact_person: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
        is_active: true,
      };
      mockRepo.findOne.mockResolvedValue(existing);
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', {
        name: 'Ranjith Mobile Pvt Ltd',
      });

      expect(result.name).toBe('Ranjith Mobile Pvt Ltd');
    });

    it('updates the name with the provided value (post-DTO normalization)', async () => {
      const existing = { id: 's1', name: 'Ranjith Mobile', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      // The DTO's @Transform trims the name before the service is called.
      const result = await service.update('s1', {
        name: 'Ranjith Mobile Pvt Ltd',
      });

      expect(result.name).toBe('Ranjith Mobile Pvt Ltd');
    });

    it('does not fire uniqueness check when name unchanged (case-insensitive)', async () => {
      const existing = { id: 's1', name: 'Ranjith Mobile', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.update('s1', { name: 'RANJITH MOBILE' });

      expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('throws ConflictException when renaming to an existing name (case-insensitive)', async () => {
      const existing = { id: 's1', name: 'Ranjith Mobile', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockQueryBuilder.getOne.mockResolvedValue({
        id: 's2',
        name: 'Other Shop',
      });

      await expect(
        service.update('s1', { name: 'other shop' }),
      ).rejects.toThrow(ConflictException);
    });

    it('updates optional fields with the provided values (post-DTO normalization)', async () => {
      const existing = {
        id: 's1',
        name: 'Ranjith Mobile',
        contact_person: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
        is_active: true,
      };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      // The DTO's @Transform trims strings before the service is called.
      const result = await service.update('s1', {
        contact_person: 'Ranjith',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45, Galle Road',
        notes: '30-day terms',
      });

      expect(result.contact_person).toBe('Ranjith');
      expect(result.phone).toBe('0771234567');
      expect(result.email).toBe('ranjith@shop.lk');
      expect(result.address).toBe('No 45, Galle Road');
      expect(result.notes).toBe('30-day terms');
    });

    it('clears optional fields when null is passed (post-DTO normalization)', async () => {
      const existing = {
        id: 's1',
        name: 'Ranjith Mobile',
        contact_person: 'Ranjith',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45, Galle Road',
        notes: '30-day terms',
        is_active: true,
      };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      // The DTO's @Transform converts empty strings to null before the
      // service is called. Test the post-transform contract directly.
      const result = await service.update('s1', {
        contact_person: null as unknown as string,
        phone: null as unknown as string,
        email: null as unknown as string,
        address: null as unknown as string,
        notes: null as unknown as string,
      });

      expect(result.contact_person).toBeNull();
      expect(result.phone).toBeNull();
      expect(result.email).toBeNull();
      expect(result.address).toBeNull();
      expect(result.notes).toBeNull();
    });

    it('does not touch fields that are not sent (dirty-fields PATCH semantics)', async () => {
      const existing = {
        id: 's1',
        name: 'Ranjith Mobile',
        contact_person: 'Ranjith',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45',
        notes: 'old note',
        is_active: true,
      };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', { notes: 'updated note' });

      expect(result.contact_person).toBe('Ranjith');
      expect(result.phone).toBe('0771234567');
      expect(result.email).toBe('ranjith@shop.lk');
      expect(result.address).toBe('No 45');
      expect(result.notes).toBe('updated note');
    });
  });

  describe('deactivate', () => {
    it('flips is_active to false', async () => {
      const existing = {
        id: 's1',
        name: 'Ranjith Mobile',
        is_active: true,
      };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.deactivate('s1');

      expect(result.is_active).toBe(false);
    });

    it('is idempotent when already inactive', async () => {
      const existing = {
        id: 's1',
        name: 'Ranjith Mobile',
        is_active: false,
      };
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.deactivate('s1');

      expect(result).toBe(existing);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when supplier does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivate', () => {
    it('flips is_active to true', async () => {
      const existing = {
        id: 's1',
        name: 'Ranjith Mobile',
        is_active: false,
      };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.reactivate('s1');

      expect(result.is_active).toBe(true);
    });

    it('is idempotent when already active', async () => {
      const existing = {
        id: 's1',
        name: 'Ranjith Mobile',
        is_active: true,
      };
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.reactivate('s1');

      expect(result).toBe(existing);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when supplier does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.reactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getSalesCount', () => {
    it('returns count: 0 for an existing supplier (stub until Slice H1)', async () => {
      const existing = { id: 's1', name: 'Ranjith Mobile' };
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.getSalesCount('s1');

      expect(result).toEqual({ count: 0 });
    });

    it('throws NotFoundException when the supplier does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.getSalesCount('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
