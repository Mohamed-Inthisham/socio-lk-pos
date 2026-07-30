import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { Category } from './entities/category.entity';

describe('CategoriesService', () => {
  let service: CategoriesService;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryBuilder.where.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();
    mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getRepositoryToken(Category), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a top-level category and trims name', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 'c1', ...e }),
      );

      const result = await service.create({ name: '  Accessories  ' });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Accessories', parent_id: null }),
      );
      expect(result.name).toBe('Accessories');
    });

    it('creates a child category when parent is top-level', async () => {
      // findOne for the parent — returns a top-level parent
      mockRepo.findOne.mockResolvedValue({
        id: 'parent-1',
        name: 'Accessories',
        parent_id: null,
      });
      // uniqueness query — no conflict
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 'c2', ...e }),
      );

      const result = await service.create({
        name: 'Cables',
        parent_id: 'parent-1',
      });

      expect(result.name).toBe('Cables');
      expect(result.parent_id).toBe('parent-1');
    });

    it('throws BadRequestException when parent itself has a parent (three-level attempt)', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'sub-parent',
        name: 'Cables',
        parent_id: 'some-grandparent',
      });

      await expect(
        service.create({ name: 'USB-C', parent_id: 'sub-parent' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the specified parent does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Cables', parent_id: 'missing-parent' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when a sibling with the same name exists (case-insensitive)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue({
        id: 'existing',
        name: 'Accessories',
      });

      await expect(service.create({ name: 'accessories' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('returns only active categories by default, sorted by sort_order + name', async () => {
      const cats = [{ id: 'c1', name: 'Accessories' }];
      mockRepo.find.mockResolvedValue(cats);

      const result = await service.findAll();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { is_active: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      });
      expect(result).toBe(cats);
    });

    it('returns all when includeInactive is true', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAll(true);

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { sort_order: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('findTopLevel', () => {
    it('filters to parent_id IS NULL and active by default', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findTopLevel();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: expect.objectContaining({ is_active: true }),
        order: { sort_order: 'ASC', name: 'ASC' },
      });
      const callArg = mockRepo.find.mock.calls[0][0];
      expect(callArg.where.parent_id).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('returns the category when found', async () => {
      const cat = { id: 'c1', name: 'Accessories' };
      mockRepo.findOne.mockResolvedValue(cat);

      const result = await service.findOne('c1');

      expect(result).toBe(cat);
    });

    it('throws NotFoundException when missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('renames a category', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'c1',
        name: 'Accessories',
        parent_id: null,
        is_active: true,
      });
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('c1', {
        name: 'Accessories & Parts',
      });

      expect(result.name).toBe('Accessories & Parts');
    });

    it('throws BadRequestException when setting parent_id to self', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'c1',
        name: 'X',
        parent_id: null,
        is_active: true,
      });

      await expect(service.update('c1', { parent_id: 'c1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when trying to demote a category that has children', async () => {
      // Load the category being updated
      mockRepo.findOne.mockResolvedValueOnce({
        id: 'c1',
        name: 'Accessories',
        parent_id: null,
        is_active: true,
      });
      // Load the proposed new parent (top-level)
      mockRepo.findOne.mockResolvedValueOnce({
        id: 'parent-1',
        name: 'Some Top',
        parent_id: null,
      });
      // The count query for children of c1 returns > 0
      mockRepo.count.mockResolvedValue(3);

      await expect(
        service.update('c1', { parent_id: 'parent-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the new parent is itself a child (three-level attempt)', async () => {
      mockRepo.findOne.mockResolvedValueOnce({
        id: 'c1',
        name: 'X',
        parent_id: null,
        is_active: true,
      });
      // Proposed new parent is a child
      mockRepo.findOne.mockResolvedValueOnce({
        id: 'sub',
        name: 'Sub',
        parent_id: 'grandparent',
      });

      await expect(service.update('c1', { parent_id: 'sub' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException when rename collides with a sibling', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'c1',
        name: 'Cables',
        parent_id: 'accessories',
        is_active: true,
      });
      mockQueryBuilder.getOne.mockResolvedValue({ id: 'c2', name: 'Chargers' });

      await expect(service.update('c1', { name: 'chargers' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not re-check uniqueness when only sort_order changes', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'c1',
        name: 'Cables',
        parent_id: null,
        is_active: true,
      });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.update('c1', { sort_order: 5 });

      expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('flips is_active to false', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'c1',
        name: 'Cables',
        is_active: true,
      });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.deactivate('c1');

      expect(result.is_active).toBe(false);
    });

    it('is idempotent when already inactive', async () => {
      const inactive = { id: 'c1', is_active: false };
      mockRepo.findOne.mockResolvedValue(inactive);

      const result = await service.deactivate('c1');

      expect(result).toBe(inactive);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivate', () => {
    it('flips is_active to true', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'c1',
        name: 'Cables',
        is_active: false,
      });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.reactivate('c1');

      expect(result.is_active).toBe(true);
    });

    it('is idempotent when already active', async () => {
      const active = { id: 'c1', is_active: true };
      mockRepo.findOne.mockResolvedValue(active);

      const result = await service.reactivate('c1');

      expect(result).toBe(active);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.reactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
