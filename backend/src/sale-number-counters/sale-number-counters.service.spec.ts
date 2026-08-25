import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { DateTime } from 'luxon';
import { SaleNumberCountersService } from './sale-number-counters.service';

describe('SaleNumberCountersService', () => {
  let service: SaleNumberCountersService;

  const mockQueryBuilder = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const mockManager = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    query: jest.fn(),
  };

  const mockRepo = {
    findOne: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb: (m: typeof mockManager) => unknown) =>
      Promise.resolve(cb(mockManager)),
    ),
    getRepository: jest.fn().mockReturnValue(mockRepo),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryBuilder.setLock.mockReturnThis();
    mockQueryBuilder.where.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();
    mockManager.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    mockDataSource.transaction.mockImplementation(
      (cb: (m: typeof mockManager) => unknown) =>
        Promise.resolve(cb(mockManager)),
    );
    mockDataSource.getRepository.mockReturnValue(mockRepo);

    // Freeze "now" to a known Colombo-morning moment so date-derived
    // assertions don't drift based on when tests run.
    // 2026-08-25 10:00 Colombo = 2026-08-25 04:30 UTC
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-25T04:30:00Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleNumberCountersService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<SaleNumberCountersService>(SaleNumberCountersService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateNext (standalone)', () => {
    it('returns a formatted INV-YYYYMMDD-NNNN', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockManager.query.mockResolvedValue([{ last_number: 1 }]);

      const result = await service.generateNext('branch-1');

      expect(result).toBe('INV-20260825-0001');
    });

    it('zero-pads last_number to 4 digits', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockManager.query.mockResolvedValue([{ last_number: 42 }]);

      const result = await service.generateNext('branch-1');

      expect(result).toBe('INV-20260825-0042');
    });

    it('handles values above 9999 by expanding beyond 4 digits', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockManager.query.mockResolvedValue([{ last_number: 10000 }]);

      const result = await service.generateNext('branch-1');

      // padStart is a minimum, not a maximum — 10000 stays as 5 digits
      expect(result).toBe('INV-20260825-10000');
    });

    it('uses pessimistic_write lock', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockManager.query.mockResolvedValue([{ last_number: 1 }]);

      await service.generateNext('branch-1');

      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
    });

    it('runs inside a transaction when no manager passed', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockManager.query.mockResolvedValue([{ last_number: 1 }]);

      await service.generateNext('branch-1');

      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it('uses Asia/Colombo timezone for the date segment', async () => {
      // Set clock to 2026-08-25 22:00 UTC — that is 2026-08-26 03:30 Colombo.
      // Sale number should be for the 26th (Colombo), not the 25th (UTC).
      jest.setSystemTime(new Date('2026-08-25T22:00:00Z'));
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockManager.query.mockResolvedValue([{ last_number: 1 }]);

      const result = await service.generateNext('branch-1');

      expect(result).toBe('INV-20260826-0001');
    });
  });

  describe('generateNext (enlisted in outer transaction)', () => {
    it('uses the passed manager instead of opening a new transaction', async () => {
      const outerManager = {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        query: jest.fn().mockResolvedValue([{ last_number: 5 }]),
      };

      const result = await service.generateNext(
        'branch-1',
        outerManager as unknown as EntityManager,
      );

      expect(result).toBe('INV-20260825-0005');
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
      expect(outerManager.query).toHaveBeenCalled();
    });

    it('takes the row lock via the passed manager, not the internal one', async () => {
      const outerQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      const outerManager = {
        createQueryBuilder: jest.fn().mockReturnValue(outerQueryBuilder),
        query: jest.fn().mockResolvedValue([{ last_number: 1 }]),
      };

      await service.generateNext(
        'branch-1',
        outerManager as unknown as EntityManager,
      );

      expect(outerQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
      // The service's internal mockManager should NOT have been used
      expect(mockManager.query).not.toHaveBeenCalled();
    });
  });

  describe('peekNext', () => {
    it('returns the next number without incrementing when a counter row exists', async () => {
      mockRepo.findOne.mockResolvedValue({
        branch_id: 'branch-1',
        counter_date: '2026-08-25',
        last_number: 41,
      });

      const result = await service.peekNext('branch-1');

      expect(result).toBe('INV-20260825-0042');
    });

    it('returns -0001 when no counter row exists yet for today', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.peekNext('branch-1');

      expect(result).toBe('INV-20260825-0001');
    });

    it('does not run inside a transaction', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await service.peekNext('branch-1');

      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not take a lock', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await service.peekNext('branch-1');

      expect(mockQueryBuilder.setLock).not.toHaveBeenCalled();
    });
  });

  describe('Colombo timezone edge cases', () => {
    it('at 23:59 Colombo (18:29 UTC) uses today', async () => {
      // 2026-08-25 18:29 UTC = 2026-08-25 23:59 Colombo
      jest.setSystemTime(new Date('2026-08-25T18:29:00Z'));
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockManager.query.mockResolvedValue([{ last_number: 1 }]);

      const result = await service.generateNext('branch-1');

      expect(result).toBe('INV-20260825-0001');
    });

    it('at 00:01 Colombo (18:31 UTC previous day) uses new day', async () => {
      // 2026-08-25 18:31 UTC = 2026-08-26 00:01 Colombo
      jest.setSystemTime(new Date('2026-08-25T18:31:00Z'));
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockManager.query.mockResolvedValue([{ last_number: 1 }]);

      const result = await service.generateNext('branch-1');

      expect(result).toBe('INV-20260826-0001');
    });

    it('reference: luxon agrees with our clock manipulation', () => {
      // Sanity — makes sure jest.setSystemTime actually affects luxon
      jest.setSystemTime(new Date('2026-08-25T18:31:00Z'));
      const date = DateTime.now().setZone('Asia/Colombo').toISODate();
      expect(date).toBe('2026-08-26');
    });
  });
});
