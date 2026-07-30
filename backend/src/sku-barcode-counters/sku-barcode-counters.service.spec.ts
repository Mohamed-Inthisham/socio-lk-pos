import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { InternalServerErrorException } from '@nestjs/common';
import { SkuBarcodeCountersService } from './sku-barcode-counters.service';
import { CounterType } from './enums/counter-type.enum';

describe('SkuBarcodeCountersService', () => {
  let service: SkuBarcodeCountersService;

  // Mock the transactional entity manager passed to the transaction callback
  const mockQueryBuilder = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const mockManager = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    save: jest.fn(),
  };

  // Mock DataSource — transaction() invokes callback with the mock manager,
  // getRepository() is used by peek()
  const mockRepo = {
    findOne: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn(async (cb: (m: typeof mockManager) => unknown) =>
      cb(mockManager),
    ),
    getRepository: jest.fn().mockReturnValue(mockRepo),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryBuilder.setLock.mockReturnThis();
    mockQueryBuilder.where.mockReturnThis();
    mockManager.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    mockDataSource.transaction.mockImplementation(
      async (cb: (m: typeof mockManager) => unknown) => cb(mockManager),
    );
    mockDataSource.getRepository.mockReturnValue(mockRepo);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkuBarcodeCountersService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<SkuBarcodeCountersService>(SkuBarcodeCountersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('next', () => {
    it('increments the counter and returns a formatted SKU', async () => {
      const counter = {
        counter_type: 'SKU',
        prefix: 'SKU-',
        current_value: 46,
      };
      mockQueryBuilder.getOne.mockResolvedValue(counter);
      mockManager.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.next(CounterType.SKU);

      expect(result).toBe('SKU-000047');
      expect(counter.current_value).toBe(47);
    });

    it('increments the counter and returns a formatted BARCODE', async () => {
      const counter = {
        counter_type: 'BARCODE',
        prefix: 'SLP-',
        current_value: 131,
      };
      mockQueryBuilder.getOne.mockResolvedValue(counter);
      mockManager.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.next(CounterType.BARCODE);

      expect(result).toBe('SLP-000132');
    });

    it('formats value 1 as 000001 (zero-padded to 6 digits)', async () => {
      const counter = { counter_type: 'SKU', prefix: 'SKU-', current_value: 0 };
      mockQueryBuilder.getOne.mockResolvedValue(counter);
      mockManager.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.next(CounterType.SKU);

      expect(result).toBe('SKU-000001');
    });

    it('handles values above 999999 by expanding beyond 6 digits', async () => {
      const counter = {
        counter_type: 'SKU',
        prefix: 'SKU-',
        current_value: 999999,
      };
      mockQueryBuilder.getOne.mockResolvedValue(counter);
      mockManager.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.next(CounterType.SKU);

      // padStart is a minimum, not a maximum — 1000000 stays as 7 digits
      expect(result).toBe('SKU-1000000');
    });

    it('uses pessimistic_write lock', async () => {
      const counter = { counter_type: 'SKU', prefix: 'SKU-', current_value: 5 };
      mockQueryBuilder.getOne.mockResolvedValue(counter);
      mockManager.save.mockImplementation((c) => Promise.resolve(c));

      await service.next(CounterType.SKU);

      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
    });

    it('runs inside a transaction', async () => {
      const counter = { counter_type: 'SKU', prefix: 'SKU-', current_value: 5 };
      mockQueryBuilder.getOne.mockResolvedValue(counter);
      mockManager.save.mockImplementation((c) => Promise.resolve(c));

      await service.next(CounterType.SKU);

      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when the counter row is missing', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(service.next(CounterType.SKU)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('saves the incremented counter back to the DB', async () => {
      const counter = {
        counter_type: 'SKU',
        prefix: 'SKU-',
        current_value: 10,
      };
      mockQueryBuilder.getOne.mockResolvedValue(counter);
      mockManager.save.mockImplementation((c) => Promise.resolve(c));

      await service.next(CounterType.SKU);

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ current_value: 11 }),
      );
    });
  });

  describe('peek', () => {
    it('returns the current state without incrementing', async () => {
      mockRepo.findOne.mockResolvedValue({
        counter_type: 'SKU',
        prefix: 'SKU-',
        current_value: 46,
      });

      const result = await service.peek(CounterType.SKU);

      expect(result).toEqual({
        prefix: 'SKU-',
        current_value: 46,
        next_formatted: 'SKU-000047',
      });
    });

    it('does not run inside a transaction', async () => {
      mockRepo.findOne.mockResolvedValue({
        counter_type: 'SKU',
        prefix: 'SKU-',
        current_value: 5,
      });

      await service.peek(CounterType.SKU);

      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not take a lock', async () => {
      mockRepo.findOne.mockResolvedValue({
        counter_type: 'SKU',
        prefix: 'SKU-',
        current_value: 5,
      });

      await service.peek(CounterType.SKU);

      expect(mockQueryBuilder.setLock).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when counter row is missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.peek(CounterType.SKU)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
