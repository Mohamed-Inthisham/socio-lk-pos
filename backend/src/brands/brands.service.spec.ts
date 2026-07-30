import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { Brand } from './entities/brand.entity';

describe('BrandsService', () => {
  let service: BrandsService;

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
        BrandsService,
        { provide: getRepositoryToken(Brand), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<BrandsService>(BrandsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a brand and trims whitespace from name', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 'b1', ...e }),
      );

      const result = await service.create({ name: '  Apple  ' });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Apple' }),
      );
      expect(result.name).toBe('Apple');
    });

    it('throws ConflictException when name already exists (case-insensitive)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue({
        id: 'existing',
        name: 'Apple',
      });

      await expect(service.create({ name: 'apple' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('returns only active brands by default, sorted by name ASC', async () => {
      const brands = [{ id: 'b1', name: 'Apple', is_active: true }];
      mockRepo.find.mockResolvedValue(brands);

      const result = await service.findAll();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { is_active: true },
        order: { name: 'ASC' },
      });
      expect(result).toBe(brands);
    });

    it('returns all brands when includeInactive is true', async () => {
      const brands = [
        { id: 'b1', name: 'Apple', is_active: true },
        { id: 'b2', name: 'Nokia', is_active: false },
      ];
      mockRepo.find.mockResolvedValue(brands);

      const result = await service.findAll(true);

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { name: 'ASC' },
      });
      expect(result).toBe(brands);
    });
  });

  describe('findOne', () => {
    it('returns the brand when found', async () => {
      const brand = { id: 'b1', name: 'Apple' };
      mockRepo.findOne.mockResolvedValue(brand);

      const result = await service.findOne('b1');

      expect(result).toBe(brand);
    });

    it('throws NotFoundException when the brand does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('partially updates a brand', async () => {
      const existing = { id: 'b1', name: 'Apple', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('b1', { name: 'Apple Inc' });

      expect(result.name).toBe('Apple Inc');
    });

    it('trims whitespace on renamed name', async () => {
      const existing = { id: 'b1', name: 'Apple', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('b1', { name: '  Apple Inc  ' });

      expect(result.name).toBe('Apple Inc');
    });

    it('does not fire uniqueness check when name unchanged (case-insensitive)', async () => {
      const existing = { id: 'b1', name: 'Apple', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.update('b1', { name: 'APPLE' });

      // Should not call the query builder for uniqueness check
      expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('throws ConflictException when renaming to an existing name (case-insensitive)', async () => {
      const existing = { id: 'b1', name: 'Apple', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockQueryBuilder.getOne.mockResolvedValue({ id: 'b2', name: 'Samsung' });

      await expect(service.update('b1', { name: 'samsung' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('deactivate', () => {
    it('flips is_active to false', async () => {
      const existing = { id: 'b1', name: 'Apple', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.deactivate('b1');

      expect(result.is_active).toBe(false);
    });

    it('is idempotent when already inactive', async () => {
      const existing = { id: 'b1', name: 'Apple', is_active: false };
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.deactivate('b1');

      expect(result).toBe(existing);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when brand does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivate', () => {
    it('flips is_active to true', async () => {
      const existing = { id: 'b1', name: 'Apple', is_active: false };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.reactivate('b1');

      expect(result.is_active).toBe(true);
    });

    it('is idempotent when already active', async () => {
      const existing = { id: 'b1', name: 'Apple', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.reactivate('b1');

      expect(result).toBe(existing);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when brand does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.reactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
