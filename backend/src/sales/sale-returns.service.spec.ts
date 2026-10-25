import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { SaleReturnsService } from './sale-returns.service';
import { SalesService } from './sales.service';
import { Sale } from './entities/sale.entity';
import { SaleLine } from './entities/sale-line.entity';
import { Payment } from './entities/payment.entity';
import { SaleReturn } from './entities/sale-return.entity';
import { SaleStatus } from './enums/sale-status.enum';
import { PaymentMethod } from './enums/payment-method.enum';
import { ReturnCondition } from './enums/return-condition.enum';
import { CreateSaleReturnDto } from './dto/create-sale-return.dto';
import { Stock } from '../stock/entities/stock.entity';
import { StockService } from '../stock/stock.service';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { ProductUnitsService } from '../product-units/product-units.service';
import { SaleNumberCountersService } from '../sale-number-counters/sale-number-counters.service';
import { SaleNumberKind } from '../sale-number-counters/enums/sale-number-kind.enum';
import { ApprovalsService } from '../approvals/approvals.service';
import { UserRole } from '../users/enums/user-role.enum';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { lockInventoryRows } from '../stock/lock-inventory-rows';
import { assertDayOpen } from '../cash-days/day-gate';

// The lock helper takes its own queries; mocked so the manager mock stays
// exact (as in sales.service.spec.ts).
jest.mock('../stock/lock-inventory-rows');
// The day gate (P9-9, P9-10) likewise; mocked, today is open.
jest.mock('../cash-days/day-gate');

const lockMock = lockInventoryRows as jest.MockedFunction<
  typeof lockInventoryRows
>;
const dayMock = assertDayOpen as jest.MockedFunction<typeof assertDayOpen>;

/** The gate's refusal, as assertDayOpen throws it. */
const dayRefusal = (code: 'DAY_NOT_OPEN' | 'DAY_CLOSED') =>
  new ConflictException({
    message: `Today (2026-10-25) ${code === 'DAY_CLOSED' ? 'is closed' : 'hasn’t been opened'}.`,
    code,
    business_date: '2026-10-25',
  });

/**
 * The order of a return's checks (Phase 6.4 P7, R1 – R12; P7-27, P7-34)
 * and that every refusal before the PIN leaves ApprovalsService.verify
 * uncalled. The database behaviour (locks, races, constraints) is in
 * test/returns.e2e-spec.ts.
 */
describe('SaleReturnsService', () => {
  let service: SaleReturnsService;

  const cashier = {
    id: 'cashier-1',
    full_name: 'Till Cashier',
    role: UserRole.CASHIER,
    branch_id: 'branch-1',
  };
  const manager = {
    id: 'manager-1',
    full_name: 'Shop Manager',
    role: UserRole.MANAGER,
  };

  const sale = (overrides: Partial<Sale> = {}): Sale =>
    ({
      id: 'sale-1',
      status: SaleStatus.COMPLETED,
      branch_id: 'branch-1',
      sale_number: 'INV-20261024-0001',
      total: '3900.00',
      ...overrides,
    }) as Sale;

  // 3 × 1000.00 less 100.00 (line_total 2900.00), and a phone at 1000.00.
  const stockLine = (overrides: Partial<SaleLine> = {}): SaleLine =>
    ({
      id: 'line-1',
      sale_id: 'sale-1',
      product_id: 'prod-1',
      product_name_snapshot: 'Charger',
      quantity: 3,
      returned_quantity: 0,
      line_total: '2900.00',
      external_supplier_id: null,
      product_unit_id: null,
      imei_snapshot: null,
      ...overrides,
    }) as SaleLine;
  const phoneLine = (overrides: Partial<SaleLine> = {}): SaleLine =>
    ({
      id: 'line-2',
      sale_id: 'sale-1',
      product_id: 'prod-2',
      product_name_snapshot: 'Used iPhone 12',
      quantity: 1,
      returned_quantity: 0,
      line_total: '1000.00',
      external_supplier_id: null,
      product_unit_id: 'unit-1',
      imei_snapshot: '356938035643809',
      ...overrides,
    }) as SaleLine;

  const cashPayment = {
    id: 'pay-cash',
    sale_id: 'sale-1',
    payment_method: PaymentMethod.CASH,
    amount: '2900.00',
  } as Payment;
  const cardPayment = {
    id: 'pay-card',
    sale_id: 'sale-1',
    payment_method: PaymentMethod.CARD,
    amount: '1000.00',
  } as Payment;

  // What the manager mock answers, per test.
  let fixtures: {
    recorded: Partial<SaleReturn> | null;
    lines: SaleLine[];
    payments: Payment[];
    stocks: Partial<Stock>[];
    units: Partial<ProductUnit>[];
    withinWarranty: string[];
    priorRefunds: { payment_id: string; refunded: string }[];
  };

  const mockManager = {
    findOne: jest.fn(),
    find: jest.fn(),
    query: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
    getRepository: jest.fn(),
  };
  // The sale lock (setLock/where/getOne) and the refund inserts
  // (insert/into/values/execute).
  const mockLockQueryBuilder = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };
  const mockDataSource = {
    manager: mockManager,
    transaction: jest.fn(),
  };
  const mockSalesRepo = { findOne: jest.fn() };
  const mockSalesService = { findOne: jest.fn() };
  const mockStockService = { incrementForReversal: jest.fn() };
  const mockProductUnitsService = {
    assertNotTakenBackForReturn: jest.fn(),
    markInspectionForReturn: jest.fn(),
  };
  const mockCounters = { generateNext: jest.fn() };
  const mockApprovals = { verify: jest.fn() };
  const mockAuditRepo = { save: jest.fn() };

  const dto = (
    overrides: Partial<CreateSaleReturnDto> = {},
  ): CreateSaleReturnDto => ({
    client_request_id: 'crid-1',
    lines: [
      {
        sale_line_id: 'line-1',
        quantity: 1,
        condition: ReturnCondition.RESALEABLE,
      },
    ],
    refunds: [{ method: PaymentMethod.CASH, amount: 966.67 }],
    reason: 'Changed mind',
    approval: { approver_id: 'manager-1', pin: '482916' },
    ...overrides,
  });

  /** The refusal's body, or fails if `promise` doesn't reject with one. */
  const refusal = async (promise: Promise<unknown>) => {
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    return {
      err: err as HttpException,
      body: (err as HttpException).getResponse() as Record<string, unknown>,
    };
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    fixtures = {
      recorded: null,
      lines: [stockLine(), phoneLine()],
      payments: [cashPayment, cardPayment],
      stocks: [{ product_id: 'prod-1', manage_stock: true }],
      units: [{ id: 'unit-1', status: ProductUnitStatus.SOLD }],
      withinWarranty: ['line-1', 'line-2'],
      priorRefunds: [],
    };
    mockSalesRepo.findOne.mockImplementation(() => Promise.resolve(sale()));
    mockManager.findOne.mockImplementation(() =>
      Promise.resolve(fixtures.recorded),
    );
    mockManager.find.mockImplementation((entity: unknown) => {
      if (entity === SaleLine) return Promise.resolve(fixtures.lines);
      if (entity === Payment) return Promise.resolve(fixtures.payments);
      if (entity === Stock) return Promise.resolve(fixtures.stocks);
      if (entity === ProductUnit) return Promise.resolve(fixtures.units);
      return Promise.resolve([]);
    });
    mockManager.query.mockImplementation((sql: string) => {
      if (sql.includes('warranty_until')) {
        return Promise.resolve(
          fixtures.lines.map((l) => ({
            id: l.id,
            within: fixtures.withinWarranty.includes(l.id),
          })),
        );
      }
      if (sql.includes('FROM sale_refunds')) {
        return Promise.resolve(fixtures.priorRefunds);
      }
      if (sql.includes('SUM(refund_total)')) {
        return Promise.resolve([{ total: '0' }]);
      }
      return Promise.resolve(undefined);
    });
    mockManager.create.mockImplementation((_: unknown, v: unknown) => v);
    mockManager.save.mockImplementation((v: unknown) =>
      Promise.resolve(Array.isArray(v) ? v : { id: 'ret-1', ...(v as object) }),
    );
    mockLockQueryBuilder.setLock.mockReturnThis();
    mockLockQueryBuilder.where.mockReturnThis();
    mockLockQueryBuilder.insert.mockReturnThis();
    mockLockQueryBuilder.into.mockReturnThis();
    mockLockQueryBuilder.values.mockReturnThis();
    mockLockQueryBuilder.getOne.mockImplementation(() =>
      Promise.resolve(sale()),
    );
    mockManager.createQueryBuilder.mockReturnValue(mockLockQueryBuilder);
    mockManager.getRepository.mockReturnValue(mockAuditRepo);
    mockDataSource.transaction.mockImplementation(
      (cb: (m: typeof mockManager) => unknown) => cb(mockManager),
    );
    mockSalesService.findOne.mockResolvedValue({ id: 'sale-1' });
    mockApprovals.verify.mockResolvedValue(manager);
    mockCounters.generateNext.mockResolvedValue('RET-20261024-0001');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleReturnsService,
        { provide: getRepositoryToken(Sale), useValue: mockSalesRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: SalesService, useValue: mockSalesService },
        { provide: StockService, useValue: mockStockService },
        { provide: ProductUnitsService, useValue: mockProductUnitsService },
        { provide: SaleNumberCountersService, useValue: mockCounters },
        { provide: ApprovalsService, useValue: mockApprovals },
      ],
    }).compile();

    service = module.get(SaleReturnsService);
  });

  const expectNoPin = () => {
    expect(mockApprovals.verify).not.toHaveBeenCalled();
    expect(mockDataSource.transaction).not.toHaveBeenCalled();
  };

  describe('before the PIN', () => {
    it('R2: 404 when the sale does not exist', async () => {
      mockSalesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createReturn('missing', dto(), cashier),
      ).rejects.toThrow(NotFoundException);
      expectNoPin();
    });

    it('R3: the same sale and user get the recorded return, unchecked, with no PIN', async () => {
      fixtures.recorded = {
        id: 'ret-9',
        sale_id: 'sale-1',
        requested_by: 'cashier-1',
      };
      // Everything else about the request is wrong; R3 comes first.
      mockSalesRepo.findOne.mockResolvedValue(
        sale({ status: SaleStatus.VOIDED }),
      );

      const result = await service.createReturn(
        'sale-1',
        dto({ refunds: [{ method: PaymentMethod.CASH, amount: 99999 }] }),
        cashier,
      );

      expect(result).toEqual({
        created: false,
        return_id: 'ret-9',
        sale: { id: 'sale-1' },
      });
      expectNoPin();
    });

    it.each([
      ['another sale', { sale_id: 'sale-2', requested_by: 'cashier-1' }],
      ['another user', { sale_id: 'sale-1', requested_by: 'cashier-2' }],
    ])(
      'R3: 409 CLIENT_REQUEST_ID_CONFLICT for an id used on %s, revealing nothing',
      async (_, recorded) => {
        fixtures.recorded = { id: 'ret-9', ...recorded };

        const { err, body } = await refusal(
          service.createReturn('sale-1', dto(), cashier),
        );

        expect(err).toBeInstanceOf(ConflictException);
        expect(body).toEqual({
          message: expect.any(String) as string,
          code: 'CLIENT_REQUEST_ID_CONFLICT',
        });
        expectNoPin();
      },
    );

    it('R4 before R5: a voided sale at another branch is SALE_NOT_COMPLETED', async () => {
      mockSalesRepo.findOne.mockResolvedValue(
        sale({ status: SaleStatus.VOIDED, branch_id: 'branch-2' }),
      );

      const { err, body } = await refusal(
        service.createReturn('sale-1', dto(), cashier),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(body.code).toBe('SALE_NOT_COMPLETED');
      expectNoPin();
    });

    it('R5: 403 RETURN_WRONG_BRANCH for a user at another branch; admins anywhere', async () => {
      mockSalesRepo.findOne.mockResolvedValue(sale({ branch_id: 'branch-2' }));

      const { err, body } = await refusal(
        service.createReturn('sale-1', dto(), cashier),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(body.code).toBe('RETURN_WRONG_BRANCH');
      expectNoPin();

      fixtures.lines = [stockLine()];
      fixtures.stocks = [{ product_id: 'prod-1', manage_stock: true }];
      await service.createReturn('sale-1', dto(), {
        ...cashier,
        role: UserRole.ADMIN,
        branch_id: null,
      });
      expect(mockApprovals.verify).toHaveBeenCalled();
    });

    it('R6: 400 LINE_NOT_ON_SALE with the line', async () => {
      const { body } = await refusal(
        service.createReturn(
          'sale-1',
          dto({ lines: [{ sale_line_id: 'line-x', quantity: 1 }] }),
          cashier,
        ),
      );

      expect(body).toMatchObject({
        code: 'LINE_NOT_ON_SALE',
        sale_line_id: 'line-x',
      });
      expectNoPin();
    });

    it.each([
      ['a tracked stock line without one', 'line-1', undefined],
      ['a phone with one', 'line-2', ReturnCondition.DAMAGED],
    ])(
      'condition (P7-27): 400 RETURN_CONDITION_INVALID for %s',
      async (_, lineId, condition) => {
        const { body } = await refusal(
          service.createReturn(
            'sale-1',
            dto({
              lines: [{ sale_line_id: lineId, quantity: 1, condition }],
            }),
            cashier,
          ),
        );

        expect(body).toMatchObject({
          code: 'RETURN_CONDITION_INVALID',
          sale_line_id: lineId,
        });
        expectNoPin();
      },
    );

    it('condition: refused on an untracked product and on another shop line', async () => {
      fixtures.lines = [
        stockLine(),
        stockLine({ id: 'line-3', external_supplier_id: 'sup-1' }),
      ];
      fixtures.stocks = [{ product_id: 'prod-1', manage_stock: false }];

      for (const lineId of ['line-1', 'line-3']) {
        const { body } = await refusal(
          service.createReturn(
            'sale-1',
            dto({
              lines: [
                {
                  sale_line_id: lineId,
                  quantity: 1,
                  condition: ReturnCondition.RESALEABLE,
                },
              ],
            }),
            cashier,
          ),
        );
        expect(body).toMatchObject({
          code: 'RETURN_CONDITION_INVALID',
          sale_line_id: lineId,
        });
      }
      expectNoPin();
    });

    it('condition before R7: a missing condition wins over a quantity too high', async () => {
      const { body } = await refusal(
        service.createReturn(
          'sale-1',
          dto({ lines: [{ sale_line_id: 'line-1', quantity: 9 }] }),
          cashier,
        ),
      );

      expect(body.code).toBe('RETURN_CONDITION_INVALID');
    });

    it('R7: 409 RETURN_QTY_EXCEEDED with what is left', async () => {
      fixtures.lines = [stockLine({ returned_quantity: 2 })];

      const { err, body } = await refusal(
        service.createReturn(
          'sale-1',
          dto({
            lines: [
              {
                sale_line_id: 'line-1',
                quantity: 2,
                condition: ReturnCondition.RESALEABLE,
              },
            ],
          }),
          cashier,
        ),
      );

      expect(err).toBeInstanceOf(ConflictException);
      expect(body).toMatchObject({
        code: 'RETURN_QTY_EXCEEDED',
        sale_line_id: 'line-1',
        returnable: 1,
      });
      expectNoPin();
    });

    it('R8: a phone taken back later refuses the return before the PIN', async () => {
      mockProductUnitsService.assertNotTakenBackForReturn.mockRejectedValue(
        new ConflictException({ code: 'PHONE_TAKEN_BACK' }),
      );

      const { body } = await refusal(
        service.createReturn(
          'sale-1',
          dto({
            lines: [{ sale_line_id: 'line-2', quantity: 1 }],
            refunds: [],
          }),
          cashier,
        ),
      );

      expect(body.code).toBe('PHONE_TAKEN_BACK');
      expect(
        mockProductUnitsService.assertNotTakenBackForReturn,
      ).toHaveBeenCalledWith(mockManager, fixtures.units[0]);
      expectNoPin();
    });

    it('R9 before R10: outside warranty without an override wins over a refund too high', async () => {
      fixtures.withinWarranty = ['line-2'];

      const { body } = await refusal(
        service.createReturn(
          'sale-1',
          dto({ refunds: [{ method: PaymentMethod.CASH, amount: 5000 }] }),
          cashier,
        ),
      );

      expect(body).toMatchObject({
        code: 'OVERRIDE_REASON_REQUIRED',
        sale_line_ids: ['line-1'],
      });
      expectNoPin();
    });

    it('R10: 400 REFUND_TOO_HIGH with refund_due, a cent over the share', async () => {
      const { body } = await refusal(
        service.createReturn(
          'sale-1',
          dto({ refunds: [{ method: PaymentMethod.CASH, amount: 966.68 }] }),
          cashier,
        ),
      );

      expect(body).toMatchObject({
        code: 'REFUND_TOO_HIGH',
        refund_due: '966.67',
      });
      expectNoPin();
    });

    it.each([
      ['TRADE_IN', PaymentMethod.TRADE_IN, 'pay-card'],
      ['a payment of another sale', PaymentMethod.CARD, 'pay-other'],
      ['a different method', PaymentMethod.KOKO, 'pay-card'],
    ])(
      'R11: 400 REFUND_METHOD_NOT_ALLOWED for %s',
      async (_, method, paymentId) => {
        const { body } = await refusal(
          service.createReturn(
            'sale-1',
            dto({
              refunds: [
                {
                  method,
                  amount: 100,
                  original_payment_id: paymentId,
                  reference_number: 'REV-1',
                },
              ],
            }),
            cashier,
          ),
        );

        expect(body).toMatchObject({
          code: 'REFUND_METHOD_NOT_ALLOWED',
          method,
          original_payment_id: paymentId,
        });
        expectNoPin();
      },
    );

    it('R12: 409 REFUND_EXCEEDS_PAYMENT counting earlier refunds and this request', async () => {
      fixtures.priorRefunds = [{ payment_id: 'pay-card', refunded: '600.00' }];
      const card = (amount: number) => ({
        method: PaymentMethod.CARD,
        amount,
        original_payment_id: 'pay-card',
        reference_number: 'REV-2',
      });

      const { err, body } = await refusal(
        service.createReturn(
          'sale-1',
          dto({ refunds: [card(300), card(100.01)] }),
          cashier,
        ),
      );

      expect(err).toBeInstanceOf(ConflictException);
      expect(body).toMatchObject({
        code: 'REFUND_EXCEEDS_PAYMENT',
        payment_id: 'pay-card',
        refundable: '400.00',
      });
      expectNoPin();
    });

    // ---- Today's cash day (Phase 6.4 P9-9) ----

    it('checks todays cash day lock-free after R5, before R6 and the PIN', async () => {
      await service.createReturn('sale-1', dto(), cashier);

      expect(dayMock).toHaveBeenNthCalledWith(1, mockManager, 'branch-1', {
        lock: false,
      });
      const preCheck = dayMock.mock.invocationCallOrder[0];
      // R6 starts with the sale's lines (plan's first read).
      expect(preCheck).toBeLessThan(
        mockManager.find.mock.invocationCallOrder[0],
      );
      expect(preCheck).toBeLessThan(
        mockApprovals.verify.mock.invocationCallOrder[0],
      );
    });

    it.each(['DAY_NOT_OPEN', 'DAY_CLOSED'] as const)(
      '409 %s before R6 and the PIN: no PIN attempt, no transaction',
      async (code) => {
        dayMock.mockRejectedValueOnce(dayRefusal(code));

        const { err, body } = await refusal(
          service.createReturn('sale-1', dto(), cashier),
        );

        expect(err).toBeInstanceOf(ConflictException);
        expect(body).toMatchObject({ code, business_date: '2026-10-25' });
        expect(mockManager.find).not.toHaveBeenCalled();
        expectNoPin();
      },
    );

    it.each([
      ['R2, no sale', () => mockSalesRepo.findOne.mockResolvedValue(null)],
      [
        'R4, not COMPLETED',
        () =>
          mockSalesRepo.findOne.mockResolvedValue(
            sale({ status: SaleStatus.VOIDED }),
          ),
      ],
      [
        'R5, another branch',
        () =>
          mockSalesRepo.findOne.mockResolvedValue(
            sale({ branch_id: 'branch-2' }),
          ),
      ],
    ])('%s comes before the day check', async (_label, arrange) => {
      arrange();

      await expect(
        service.createReturn('sale-1', dto(), cashier),
      ).rejects.toThrow();
      expect(dayMock).not.toHaveBeenCalled();
    });

    it('R3: a resend still gets the recorded return when today is closed', async () => {
      fixtures.recorded = {
        id: 'ret-9',
        sale_id: 'sale-1',
        requested_by: 'cashier-1',
      };
      dayMock.mockRejectedValue(dayRefusal('DAY_CLOSED'));

      const result = await service.createReturn('sale-1', dto(), cashier);

      expect(result).toEqual({
        created: false,
        return_id: 'ret-9',
        sale: { id: 'sale-1' },
      });
      expect(dayMock).not.toHaveBeenCalled();
      expectNoPin();
    });
  });

  describe('the PIN and the transaction', () => {
    it('checks the PIN for SALE_RETURN at the sale branch after every check, then applies', async () => {
      const result = await service.createReturn(
        'sale-1',
        dto(),
        cashier,
        '10.0.0.5',
      );

      expect(mockApprovals.verify).toHaveBeenCalledWith({
        approverId: 'manager-1',
        pin: '482916',
        action: 'SALE_RETURN',
        branchId: 'branch-1',
        requestedBy: cashier,
        ip: '10.0.0.5',
      });
      expect(mockApprovals.verify.mock.invocationCallOrder[0]).toBeLessThan(
        mockDataSource.transaction.mock.invocationCallOrder[0],
      );
      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        mockManager,
        'prod-1',
        'branch-1',
        1,
      );
      expect(mockCounters.generateNext).toHaveBeenCalledWith(
        'branch-1',
        mockManager,
        SaleNumberKind.RETURN,
      );
      expect(mockLockQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          sale_return_id: 'ret-1',
          method: PaymentMethod.CASH,
          amount: '966.67',
          original_payment_id: null,
          reference_number: null,
        }),
      );
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.RETURN,
          user_id: 'cashier-1',
          entity_id: 'sale-1',
        }),
      );
      expect(result).toEqual({
        created: true,
        return_id: 'ret-1',
        sale: { id: 'sale-1' },
      });
    });

    it('a phone goes to INSPECTION with no stock change', async () => {
      await service.createReturn(
        'sale-1',
        dto({
          lines: [{ sale_line_id: 'line-2', quantity: 1 }],
          refunds: [],
        }),
        cashier,
      );

      expect(
        mockProductUnitsService.markInspectionForReturn,
      ).toHaveBeenCalledWith(mockManager, 'unit-1');
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('a second send that waited on the sale lock is answered as R3, writing nothing', async () => {
      // Not recorded before the PIN; recorded once the lock is held.
      mockManager.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'ret-1',
        sale_id: 'sale-1',
        requested_by: 'cashier-1',
      });

      const result = await service.createReturn('sale-1', dto(), cashier);

      expect(result.created).toBe(false);
      expect(result.return_id).toBe('ret-1');
      expect(mockManager.save).not.toHaveBeenCalled();
      expect(mockCounters.generateNext).not.toHaveBeenCalled();
    });

    it('the transaction re-checks under its locks (R7 after a parallel return)', async () => {
      mockDataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => unknown) => {
          fixtures.lines = [stockLine({ returned_quantity: 3 })];
          return cb(mockManager);
        },
      );

      const { body } = await refusal(
        service.createReturn('sale-1', dto(), cashier),
      );

      expect(body.code).toBe('RETURN_QTY_EXCEEDED');
      expect(mockApprovals.verify).toHaveBeenCalled();
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('a client_request_id clash on the unique key is answered as R3', async () => {
      const clash = new QueryFailedError('INSERT', [], {
        constraint: 'UQ_sale_returns_client_request_id',
      } as unknown as Error);
      mockDataSource.transaction.mockRejectedValue(clash);
      mockManager.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'ret-7',
        sale_id: 'sale-2',
        requested_by: 'cashier-1',
      });

      const { body } = await refusal(
        service.createReturn('sale-1', dto(), cashier),
      );

      expect(body.code).toBe('CLIENT_REQUEST_ID_CONFLICT');
    });

    // ---- Today's cash day: lock-order step 4 (Phase 6.4 P9-10) ----

    it('takes todays cash day FOR SHARE after the inventory locks and before any change', async () => {
      await service.createReturn('sale-1', dto(), cashier);

      expect(dayMock).toHaveBeenCalledTimes(2);
      expect(dayMock).toHaveBeenNthCalledWith(2, mockManager, 'branch-1', {
        lock: true,
      });
      const inTransaction = dayMock.mock.invocationCallOrder[1];
      expect(mockApprovals.verify.mock.invocationCallOrder[0]).toBeLessThan(
        inTransaction,
      );
      expect(lockMock.mock.invocationCallOrder[0]).toBeLessThan(inTransaction);
      expect(inTransaction).toBeLessThan(
        mockStockService.incrementForReversal.mock.invocationCallOrder[0],
      );
      expect(inTransaction).toBeLessThan(
        mockCounters.generateNext.mock.invocationCallOrder[0],
      );
      expect(inTransaction).toBeLessThan(
        mockManager.save.mock.invocationCallOrder[0],
      );
      expect(inTransaction).toBeLessThan(
        mockAuditRepo.save.mock.invocationCallOrder[0],
      );
    });

    it('a day closed after the pre-check is refused in the transaction, before the re-checks, writing nothing', async () => {
      // Open before the PIN; closed by the time the transaction holds its
      // locks. The re-check would also refuse (R7), but the day comes first.
      dayMock
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(dayRefusal('DAY_CLOSED'));
      mockDataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => unknown) => {
          fixtures.lines = [stockLine({ returned_quantity: 3 })];
          return cb(mockManager);
        },
      );

      const { body } = await refusal(
        service.createReturn('sale-1', dto(), cashier),
      );

      expect(body).toMatchObject({
        code: 'DAY_CLOSED',
        business_date: '2026-10-25',
      });
      expect(mockApprovals.verify).toHaveBeenCalled();
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
      expect(mockCounters.generateNext).not.toHaveBeenCalled();
      expect(mockManager.save).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });

    it('a second send answered as R3 in the transaction does not reach the day gate there', async () => {
      mockManager.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'ret-1',
        sale_id: 'sale-1',
        requested_by: 'cashier-1',
      });

      await service.createReturn('sale-1', dto(), cashier);

      expect(dayMock).toHaveBeenCalledTimes(1);
      expect(dayMock).toHaveBeenCalledWith(mockManager, 'branch-1', {
        lock: false,
      });
    });
  });
});
