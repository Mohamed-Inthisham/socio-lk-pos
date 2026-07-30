import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { Branch } from './entities/branch.entity';

describe('BranchesService', () => {
  let service: BranchesService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchesService,
        { provide: getRepositoryToken(Branch), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<BranchesService>(BranchesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a branch with all provided fields', async () => {
      const dto = {
        name: 'Kandy Shop',
        address: '123 Peradeniya Rd',
        phone: '0812223344',
        is_active: true,
      };
      const created = { id: 'branch-1', ...dto };
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(mockRepo.create).toHaveBeenCalledWith({
        name: 'Kandy Shop',
        address: '123 Peradeniya Rd',
        phone: '0812223344',
        is_active: true,
      });
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(result).toBe(created);
    });

    it('normalizes omitted address/phone to null', async () => {
      const dto = { name: 'Kandy Shop' };
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.create(dto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Kandy Shop',
          address: null,
          phone: null,
        }),
      );
    });
  });

  describe('findAll', () => {
    it('returns only active branches by default', async () => {
      const branches = [{ id: 'b1', name: 'Main Shop', is_active: true }];
      mockRepo.find.mockResolvedValue(branches);

      const result = await service.findAll();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { is_active: true },
        order: { created_at: 'ASC' },
      });
      expect(result).toBe(branches);
    });

    it('returns all branches when includeInactive is true', async () => {
      const branches = [
        { id: 'b1', name: 'Main Shop', is_active: true },
        { id: 'b2', name: 'Old Shop', is_active: false },
      ];
      mockRepo.find.mockResolvedValue(branches);

      const result = await service.findAll(true);

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { created_at: 'ASC' },
      });
      expect(result).toBe(branches);
    });
  });

  describe('findOne', () => {
    it('returns the branch when found', async () => {
      const branch = { id: 'b1', name: 'Main Shop', is_active: true };
      mockRepo.findOne.mockResolvedValue(branch);

      const result = await service.findOne('b1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'b1' } });
      expect(result).toBe(branch);
    });

    it('throws NotFoundException when the branch does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('partially updates a branch', async () => {
      const existing = {
        id: 'b1',
        name: 'Main Shop',
        address: null,
        phone: null,
        is_active: true,
      };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('b1', { name: 'Renamed' });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b1', name: 'Renamed' }),
      );
      expect(result.name).toBe('Renamed');
    });

    it('allows deactivation via update when other active branches exist', async () => {
      const existing = { id: 'b1', name: 'Main Shop', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.count.mockResolvedValue(2); // 2 active branches
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('b1', { is_active: false });

      expect(result.is_active).toBe(false);
    });

    it('throws BadRequestException when trying to deactivate the last active branch via update', async () => {
      const existing = { id: 'b1', name: 'Main Shop', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.count.mockResolvedValue(1); // only 1 active branch

      await expect(service.update('b1', { is_active: false })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('does not fire the deactivation guard when only editing name/address', async () => {
      const existing = { id: 'b1', name: 'Main Shop', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.update('b1', { name: 'Renamed', address: 'New Rd' });

      // count() should not be called since is_active isn't transitioning
      expect(mockRepo.count).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('flips is_active to false when other active branches exist', async () => {
      const existing = { id: 'b1', name: 'Main Shop', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.count.mockResolvedValue(2);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.deactivate('b1');

      expect(result.is_active).toBe(false);
    });

    it('is idempotent when branch is already inactive', async () => {
      const existing = { id: 'b1', name: 'Old Shop', is_active: false };
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.deactivate('b1');

      expect(result).toBe(existing);
      expect(mockRepo.save).not.toHaveBeenCalled();
      expect(mockRepo.count).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when deactivating the last active branch', async () => {
      const existing = { id: 'b1', name: 'Main Shop', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.count.mockResolvedValue(1); // itself is the only active one

      await expect(service.deactivate('b1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when branch does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivate', () => {
    it('flips is_active to true', async () => {
      const existing = { id: 'b1', name: 'Old Shop', is_active: false };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.reactivate('b1');

      expect(result.is_active).toBe(true);
    });

    it('is idempotent when branch is already active', async () => {
      const existing = { id: 'b1', name: 'Main Shop', is_active: true };
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.reactivate('b1');

      expect(result).toBe(existing);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when branch does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.reactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
